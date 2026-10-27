package com.pandora.server.repository;

import com.pandora.server.model.Highlight;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface HighlightRepository extends JpaRepository<Highlight, String> {
    List<Highlight> findAllByOrderByPositionAscIdAsc();
    boolean existsByKindAndAudienceAndPositionAndIdNot(String kind, String audience, int position, String id);
}
