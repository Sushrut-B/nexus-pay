package io.raftline.core.dbaas;

import java.time.Instant;

/**
 * Manifest metadata for an exported cloud database snapshot package.
 */
public record BackupManifest(
        String backupId,
        Instant timestamp,
        long snapshotIndex,
        long snapshotTerm,
        int keyCount,
        long sizeBytes,
        String sha256Checksum,
        String cloudStorageUri,
        String status
) {
    public java.util.Map<String, Object> toMap() {
        return java.util.Map.of(
                "backupId", backupId,
                "timestamp", timestamp != null ? timestamp.toString() : "",
                "snapshotIndex", snapshotIndex,
                "snapshotTerm", snapshotTerm,
                "keyCount", keyCount,
                "sizeBytes", sizeBytes,
                "sha256Checksum", sha256Checksum != null ? sha256Checksum : "",
                "cloudStorageUri", cloudStorageUri != null ? cloudStorageUri : "",
                "status", status != null ? status : ""
        );
    }
}
