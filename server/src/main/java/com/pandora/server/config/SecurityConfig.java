package com.pandora.server.config;

import com.pandora.server.service.AuthService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http, JwtFilter jwtFilter) throws Exception {
        http.csrf(AbstractHttpConfigurer::disable)
                .cors(c -> c.configurationSource(corsConfigurationSource()))
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .requestMatchers("/api/auth/**").permitAll()
                        .requestMatchers("/api/admin/**").hasAnyRole("ADMIN", "FOUNDER")
                        .requestMatchers("/", "/index.html", "/style.css", "/app.js", "/favicon.svg", "/src/**", "/assets/**").permitAll()
                        .anyRequest().authenticated()
                )
                .exceptionHandling(e -> e
                        .authenticationEntryPoint((req, res, ex) -> {
                            res.setStatus(401);
                            res.setContentType("application/json;charset=UTF-8");
                            res.getWriter().write("{\"error\":\"登录已过期，请重新登录\"}");
                        })
                        .accessDeniedHandler((req, res, ex) -> {
                            res.setStatus(403);
                            res.setContentType("application/json;charset=UTF-8");
                            res.getWriter().write("{\"error\":\"仅管理员和创始人可访问管理后台\"}");
                        }))
                .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        // 允许 App 浏览器预览（Vite 5173）与 Android WebView 本地资源源跨域访问 API
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(List.of(
                "http://localhost:5173", "http://127.0.0.1:5173",
                "http://localhost:8080", "http://127.0.0.1:8080",
                "https://appassets.androidplatform.net"));
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        config.setAllowCredentials(true);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }

    @Bean
    public JwtFilter jwtFilter(AuthService authService, UserDetailsService userDetailsService) {
        return new JwtFilter(authService, userDetailsService);
    }

    public static class JwtFilter extends OncePerRequestFilter {
        private final AuthService authService;
        private final UserDetailsService userDetailsService;

        public JwtFilter(AuthService authService, UserDetailsService userDetailsService) {
            this.authService = authService;
            this.userDetailsService = userDetailsService;
        }

        @Override
        protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
                throws ServletException, IOException {
            String header = request.getHeader("Authorization");
            if (header != null && header.startsWith("Bearer ")) {
                String token = header.substring(7);
                String username = authService.validateToken(token);
                if (username != null && SecurityContextHolder.getContext().getAuthentication() == null) {
                    UserDetails user = userDetailsService.loadUserByUsername(username);
                    UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(
                            user, null, user.getAuthorities());
                    auth.setDetails(new org.springframework.security.web.authentication.WebAuthenticationDetailsSource().buildDetails(request));
                    SecurityContextHolder.getContext().setAuthentication(auth);
                }
            }
            chain.doFilter(request, response);
        }
    }
}
