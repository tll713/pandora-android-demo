package com.pandora.server;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;

import java.time.Clock;
import java.time.ZoneId;

@SpringBootApplication
public class PandoraServerApplication {
    @Bean
    Clock businessClock() {
        return Clock.system(ZoneId.of("Asia/Shanghai"));
    }

    public static void main(String[] args) {
        SpringApplication.run(PandoraServerApplication.class, args);
    }
}
