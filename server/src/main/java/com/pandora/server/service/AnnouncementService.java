package com.pandora.server.service;

import com.pandora.server.model.Announcement;
import com.pandora.server.repository.AnnouncementRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@Service
public class AnnouncementService {

    private final AnnouncementRepository announcementRepository;

    public AnnouncementService(AnnouncementRepository announcementRepository) {
        this.announcementRepository = announcementRepository;
    }

    public List<Announcement> getAll() {
        return announcementRepository.findAll();
    }

    @Transactional
    public Announcement create(String title, String content, String category, LocalDate date) {
        if (title == null || title.trim().isEmpty()) throw new IllegalArgumentException("请填写标题");
        if (title.trim().length() > 120) throw new IllegalArgumentException("标题不能超过 120 个字");
        if (content == null || content.trim().isEmpty()) throw new IllegalArgumentException("请填写内容");
        if (category == null || category.trim().isEmpty()) category = "通知";
        Announcement a = new Announcement();
        a.setId("ann-" + UUID.randomUUID());
        a.setTitle(title.trim());
        a.setContent(content.trim());
        a.setCategory(category.trim());
        a.setDate(date != null ? date : LocalDate.now());
        return announcementRepository.save(a);
    }

    @Transactional
    public void delete(String id) {
        announcementRepository.deleteById(id);
    }
}
