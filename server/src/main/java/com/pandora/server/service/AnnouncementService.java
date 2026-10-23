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
        return announcementRepository.findAll().stream()
                .sorted(java.util.Comparator.comparing(Announcement::isPinned).reversed()
                        .thenComparing(Announcement::getDate, java.util.Comparator.reverseOrder())
                        .thenComparing(Announcement::getId))
                .toList();
    }

    @Transactional
    public Announcement create(String title, String content, String category, LocalDate date) {
        if (title == null || title.trim().isEmpty()) throw new IllegalArgumentException("请填写标题");
        if (title.trim().length() > 120) throw new IllegalArgumentException("标题不能超过 120 个字");
        if (content == null || content.trim().isEmpty()) throw new IllegalArgumentException("请填写内容");
        if (category == null || category.trim().isEmpty()) category = "通知";
        if (category.trim().length() > 40) throw new IllegalArgumentException("分类不能超过 40 个字");
        if (content.trim().length() > 20000) throw new IllegalArgumentException("内容不能超过 20000 个字");
        Announcement a = new Announcement();
        a.setId("ann-" + UUID.randomUUID());
        a.setTitle(title.trim());
        a.setContent(content.trim());
        a.setCategory(category.trim());
        a.setDate(date != null ? date : LocalDate.now());
        return announcementRepository.save(a);
    }

    @Transactional
    public Announcement update(String id, String title, String content, String category, boolean pinned) {
        Announcement a = announcementRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("公告不存在"));
        if (title == null || title.isBlank() || title.trim().length() > 120)
            throw new IllegalArgumentException("标题需为 1～120 个字");
        if (content == null || content.isBlank() || content.trim().length() > 20000)
            throw new IllegalArgumentException("内容需为 1～20000 个字");
        if (category == null || category.isBlank() || category.trim().length() > 40)
            throw new IllegalArgumentException("分类需为 1～40 个字");
        a.setTitle(title.trim());
        a.setContent(content.trim());
        a.setCategory(category.trim());
        a.setPinned(pinned);
        return announcementRepository.save(a);
    }

    @Transactional
    public void delete(String id) {
        announcementRepository.deleteById(id);
    }
}
