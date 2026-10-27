"""Build a signed offline demo APK using Google's Android build tools, without Gradle."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import urllib.request
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--tools', type=Path, default=Path(os.environ['USERPROFILE']) / '.cache/pandora-android-tools')
parser.add_argument('--java-home', type=Path, default=Path(os.environ.get('JAVA_HOME', 'C:/kaifa/Java')))
parser.add_argument('--sdk', type=Path, help='Use an installed Android SDK instead of downloading tools')
parser.add_argument('--keystore', type=Path, help='Reuse an existing demo signing key')
args = parser.parse_args()
CACHE, JAVA = args.tools.resolve(), args.java_home.resolve()
BUILD = CACHE / 'pandora-build'
manifest = ET.parse(ROOT / 'android/AndroidManifest.xml').getroot()
version = manifest.attrib['{http://schemas.android.com/apk/res/android}versionName']
version_code = manifest.attrib['{http://schemas.android.com/apk/res/android}versionCode']

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
assets = ['index.html', 'favicon.svg', 'src/app.js', 'src/domain.js', 'src/style.css', 'src/mobile.css']
for name in assets:
    shutil.copy2(ROOT / name, ASSETS / name)
run(JAVA / 'bin/javac.exe', '--release', '8', '-encoding', 'UTF-8', '-classpath', PLATFORM, '-d', BUILD / 'classes', ROOT / 'android/src/com/pandora/demo/MainActivity.java')
run(TOOLS / 'aapt.exe', 'package', '-f', '-M', ROOT / 'android/AndroidManifest.xml', '-S', ROOT / 'android/res', '-I', PLATFORM, '-A', BUILD / 'assets', '-F', BUILD / 'unsigned.apk')
classes = list((BUILD / 'classes').rglob('*.class'))
run(JAVA / 'bin/java.exe', '-cp', TOOLS / 'lib/d8.jar', 'com.android.tools.r8.D8', '--lib', PLATFORM, '--min-api', '26', '--output', BUILD / 'dex', *classes)
with zipfile.ZipFile(BUILD / 'unsigned.apk', 'a', compression=zipfile.ZIP_DEFLATED) as archive:
    archive.write(BUILD / 'dex/classes.dex', 'classes.dex')
run(TOOLS / 'zipalign.exe', '-f', '4', BUILD / 'unsigned.apk', BUILD / 'aligned.apk')
keystore = args.keystore.resolve() if args.keystore else CACHE / 'pandora-demo.keystore'
if args.keystore and not keystore.exists():
    raise SystemExit('The specified signing key does not exist.')
if not keystore.exists():
    run(JAVA / 'bin/keytool.exe', '-genkeypair', '-keystore', keystore, '-storepass', 'android', '-keypass', 'android', '-alias', 'pandora-demo', '-dname', 'CN=Pandora Classroom Demo', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-storetype', 'JKS')
output = ROOT / f'deliverables/pandora-demo-{version}.apk'
output.parent.mkdir(parents=True, exist_ok=True)
signed = BUILD / output.name
run(JAVA / 'bin/java.exe', '-jar', TOOLS / 'lib/apksigner.jar', 'sign', '--ks', keystore, '--ks-key-alias', 'pandora-demo', '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', signed, BUILD / 'aligned.apk')
run(JAVA / 'bin/java.exe', '-jar', TOOLS / 'lib/apksigner.jar', 'verify', '--verbose', '--print-certs', signed)
run(TOOLS / 'zipalign.exe', '-c', '4', signed)
run(TOOLS / 'aapt.exe', 'dump', 'badging', signed)
shutil.copy2(signed, output)
with zipfile.ZipFile(output) as archive:
    for name in assets:
        assert archive.read('assets/web/' + name) == (ROOT / name).read_bytes(), name
    assert 'classes.dex' in archive.namelist()
metadata = {'apk': output.name, 'version': version, 'versionCode': int(version_code), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'bytes': output.stat().st_size, 'minimumAndroid': '8.0 (API 26)', 'targetSdk': 35, 'embeddedAssetsMatchSource': True}
(output.parent / 'apk-build.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(metadata, ensure_ascii=False, indent=2))
