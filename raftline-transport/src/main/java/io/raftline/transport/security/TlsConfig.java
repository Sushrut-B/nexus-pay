package io.raftline.transport.security;

import java.io.File;
import java.util.Objects;

/**
 * Configuration options for mutual TLS (mTLS) authentication across
 * gRPC transport channels and servers.
 */
public class TlsConfig {
    private final boolean enabled;
    private final File certificateChainFile;
    private final File privateKeyFile;
    private final File trustCertCollectionFile;
    private final boolean requireClientAuth;

    public static TlsConfig disabled() {
        return new TlsConfig(false, null, null, null, false);
    }

    public static TlsConfig enabled(File certificateChainFile, File privateKeyFile, File trustCertCollectionFile) {
        return new TlsConfig(true, certificateChainFile, privateKeyFile, trustCertCollectionFile, true);
    }

    public TlsConfig(boolean enabled,
                     File certificateChainFile,
                     File privateKeyFile,
                     File trustCertCollectionFile,
                     boolean requireClientAuth) {
        this.enabled = enabled;
        if (enabled) {
            this.certificateChainFile = Objects.requireNonNull(certificateChainFile, "certificateChainFile cannot be null when TLS is enabled");
            this.privateKeyFile = Objects.requireNonNull(privateKeyFile, "privateKeyFile cannot be null when TLS is enabled");
            this.trustCertCollectionFile = trustCertCollectionFile;
            this.requireClientAuth = requireClientAuth;
        } else {
            this.certificateChainFile = null;
            this.privateKeyFile = null;
            this.trustCertCollectionFile = null;
            this.requireClientAuth = false;
        }
    }

    public boolean isEnabled() {
        return enabled;
    }

    public File getCertificateChainFile() {
        return certificateChainFile;
    }

    public File getPrivateKeyFile() {
        return privateKeyFile;
    }

    public File getTrustCertCollectionFile() {
        return trustCertCollectionFile;
    }

    public boolean isRequireClientAuth() {
        return requireClientAuth;
    }
}
