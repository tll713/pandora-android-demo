"""Build a signed APK using Google's Android build tools, without Gradle."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--tools', type=Path, default=Path(os.environ['USERPROFILE']) / '.cache/pandora-android-tools')
parser.add_argument('--java-home', type=Path, default=Path(os.environ.get('JAVA_HOME', 'C:/kaifa/Java')))
parser.add_argument('--sdk', type=Path, help='Use an installed Android SDK instead of downloading tools')
parser.add_argument('--api-base', default=os.environ.get('PANDORA_API_BASE'), help='Backend URL ending in /api; HTTPS required unless --allow-http')
parser.add_argument('--allow-http', action='store_true', help='Allow HTTP only for a local demonstration build')
parser.add_argument('--output', type=Path, help='Override APK destination')
parser.add_argument('--version-code', type=int, help='Explicit versionCode for a release')
parser.add_argument('--release', action='store_true', help='Require HTTPS and an explicit release signing key')
parser.add_argument('--keystore', type=Path, help='Existing signing key; required for --release')
parser.add_argument('--key-alias', help='Signing alias; required for --release')
args = parser.parse_args()
if not args.api_base:
    parser.error('Specify --api-base https://your-server/api or PANDORA_API_BASE')
api = urlsplit(args.api_base)
if api.scheme not in ('http', 'https') or not api.hostname or not re.fullmatch(r'[a-zA-Z0-9.\-:\[\]]+', api.netloc) or api.username or api.password or api.query or api.fragment or api.path != '/api':
    parser.error('API URL must be an HTTP(S) address ending in /api without credentials, query or fragment')
try:
    api.port
except ValueError:
    parser.error('API URL contains an invalid port')
if api.scheme != 'https' and not args.allow_http:
    parser.error('HTTPS is required; --allow-http is for local demonstration only')
if args.release and (args.allow_http or not args.keystore or not args.key_alias or args.key_alias == 'pandora-demo' or args.version_code is None):
    parser.error('--release requires HTTPS, --keystore, --key-alias and --version-code; demo signing and --allow-http are forbidden')
if args.release and not os.environ.get('PANDORA_KEYSTORE_PASSWORD'):
    parser.error('Set PANDORA_KEYSTORE_PASSWORD (and optionally PANDORA_KEY_PASSWORD) for release signing')
if args.keystore and not args.keystore.is_file():
    parser.error('The specified signing key does not exist')
CACHE, JAVA = args.tools.resolve(), args.java_home.resolve()
BUILD = CACHE / 'pandora-build'
ET.register_namespace('android', 'http://schemas.android.com/apk/res/android')
manifest = ET.parse(ROOT / 'android/AndroidManifest.xml')
root = manifest.getroot()
version = root.attrib['{http://schemas.android.com/apk/res/android}versionName']
version_code = int(root.attrib['{http://schemas.android.com/apk/res/android}versionCode'])
# Build a temporary manifest; compiling must not mutate checked-in sources.
version_code = args.version_code if args.version_code is not None else version_code
if version_code < 1:
    parser.error('versionCode must be positive')
root.set('{http://schemas.android.com/apk/res/android}versionCode', str(version_code))
root.find('application').set('{http://schemas.android.com/apk/res/android}usesCleartextTraffic', str(args.allow_http).lower())
BUILD.mkdir(parents=True, exist_ok=True)
build_manifest = BUILD / 'AndroidManifest.xml'
manifest.write(build_manifest, encoding='utf-8', xml_declaration=True)
build_config = BUILD / 'BuildConfig.java'
build_config.write_text('package com.pandora.demo; final class BuildConfig { static final String API_BASE = '+json.dumps(args.api_base)+'; static final boolean ALLOW_HTTP = '+str(args.allow_http).lower()+'; }', encoding='utf-8')

def run(*cmd):
    print('Running:', Path(str(cmd[0])).name, flush=True)
    subprocess.run([str(x) for x in cmd], check=True)

def install(name, folder):
    dest = CACHE / name
    target = CACHE / folder
    if not target.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        if not dest.exists():
            print('Downloading:', name, flush=True)
            urllib.request.urlretrieve('https://dl.google.com/android/repository/' + name, dest)
        with zipfile.ZipFile(dest) as archive:
            archive.extractall(target)

if args.sdk:
    sdk = args.sdk.resolve()
    versions = sorted((p for p in (sdk / 'build-tools').iterdir() if (p / 'aapt.exe').exists()), key=lambda p: tuple(int(v) for v in p.name.split('.')))
    if not versions:
        raise SystemExit('No Android build tools found in the SDK.')
    TOOLS = versions[-1]
    PLATFORM = sdk / 'platforms/android-35/android.jar'
else:
    install('platform-35_r02.zip', 'platform')
    install('build-tools_r35_windows.zip', 'build-tools')
    TOOLS = CACHE / 'build-tools/android-15'
    PLATFORM = CACHE / 'platform/android-35/android.jar'
if not (JAVA / 'bin/javac.exe').exists():
    raise SystemExit('Specify a JDK with --java-home or JAVA_HOME.')
BUILD.mkdir(parents=True, exist_ok=True)
ASSETS = BUILD / 'assets/web'
for folder in (ASSETS / 'src', BUILD / 'classes', BUILD / 'dex'):
    folder.mkdir(parents=True, exist_ok=True)
assets = ['index.html', 'favicon.svg', 'src/app.js', 'src/domain.js', 'src/date-picker.js', 'src/style.css', 'src/mobile.css']
for name in assets:
    shutil.copy2(ROOT / name, ASSETS / name)
run(JAVA / 'bin/javac.exe', '--release', '8', '-encoding', 'UTF-8', '-classpath', PLATFORM, '-d', BUILD / 'classes', ROOT / 'android/src/com/pandora/demo/MainActivity.java', build_config)
run(TOOLS / 'aapt.exe', 'package', '-f', '-M', build_manifest, '-S', ROOT / 'android/res', '-I', PLATFORM, '-A', BUILD / 'assets', '-F', BUILD / 'unsigned.apk')
classes = list((BUILD / 'classes').rglob('*.class'))
run(JAVA / 'bin/java.exe', '-cp', TOOLS / 'lib/d8.jar', 'com.android.tools.r8.D8', '--lib', PLATFORM, '--min-api', '26', '--output', BUILD / 'dex', *classes)
with zipfile.ZipFile(BUILD / 'unsigned.apk', 'a', compression=zipfile.ZIP_DEFLATED) as archive:
    archive.write(BUILD / 'dex/classes.dex', 'classes.dex')
run(TOOLS / 'zipalign.exe', '-f', '4', BUILD / 'unsigned.apk', BUILD / 'aligned.apk')
keystore = args.keystore.resolve() if args.keystore else ROOT / 'keystore/pandora-demo.keystore'
if args.keystore and not keystore.exists():
    raise SystemExit('The specified signing key does not exist.')
if not keystore.exists():
    keystore.parent.mkdir(parents=True, exist_ok=True)
    run(JAVA / 'bin/keytool.exe', '-genkeypair', '-keystore', keystore, '-storepass', 'android', '-keypass', 'android', '-alias', 'pandora-demo', '-dname', 'CN=Pandora Classroom Demo', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-storetype', 'JKS')
build_kind = 'release' if args.release else 'demo'
output = args.output.resolve() if args.output else ROOT / f'deliverables/pandora-{build_kind}-{version}.apk'
output.parent.mkdir(parents=True, exist_ok=True)
signed = BUILD / output.name
store_pass = 'env:PANDORA_KEYSTORE_PASSWORD' if args.release else 'pass:android'
key_pass = 'env:PANDORA_KEY_PASSWORD' if args.release and os.environ.get('PANDORA_KEY_PASSWORD') else store_pass
run(JAVA / 'bin/java.exe', '-jar', TOOLS / 'lib/apksigner.jar', 'sign', '--ks', keystore, '--ks-key-alias', args.key_alias or 'pandora-demo', '--ks-pass', store_pass, '--key-pass', key_pass, '--out', signed, BUILD / 'aligned.apk')
run(JAVA / 'bin/java.exe', '-jar', TOOLS / 'lib/apksigner.jar', 'verify', '--verbose', '--print-certs', signed)
run(TOOLS / 'zipalign.exe', '-c', '4', signed)
run(TOOLS / 'aapt.exe', 'dump', 'badging', signed)
shutil.copy2(signed, output)
with zipfile.ZipFile(output) as archive:
    for name in assets:
        assert archive.read('assets/web/' + name) == (ROOT / name).read_bytes(), name
    assert 'classes.dex' in archive.namelist()
metadata = {'apk': output.name, 'version': version, 'versionCode': int(version_code), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'bytes': output.stat().st_size, 'minimumAndroid': '8.0 (API 26)', 'targetSdk': 35, 'embeddedAssetsMatchSource': True, 'apiBase': args.api_base, 'allowsHttp': args.allow_http, 'buildKind': build_kind}
(output.parent / 'apk-build.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(metadata, ensure_ascii=False, indent=2))
