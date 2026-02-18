# TLS and HTTPS Deployment Guide

This guide covers TLS/HTTPS configuration for the Node.js Mirth Connect runtime. It is intended for operators migrating from Java Mirth or deploying Node.js Mirth in production for the first time.

---

## Table of Contents

1. [Architecture](#1-architecture)
2. [Reverse Proxy Setup](#2-reverse-proxy-setup)
3. [Connector TLS](#3-connector-tls)
4. [Cluster Security](#4-cluster-security)
5. [Certificate Management](#5-certificate-management)
6. [Quick Reference](#6-quick-reference)

---

## 1. Architecture

### Why HTTP-Only API

Node.js Mirth serves its REST API over **plain HTTP** on port 8080 by default. This is a deliberate architectural choice following the [twelve-factor app](https://12factor.net/) methodology: the application process does not manage TLS certificates. Instead, TLS termination is handled by infrastructure in front of the application -- a reverse proxy, load balancer, or ingress controller.

Java Mirth takes the opposite approach: it embeds a Jetty web server that terminates HTTPS directly on port 8443 using a JKS keystore configured in `mirth.properties`.

### Comparison

| Aspect | Java Mirth | Node.js Mirth |
|--------|------------|---------------|
| Default API port | 8443 (HTTPS) | 8080 (HTTP) |
| TLS termination | Application (embedded Jetty) | Infrastructure (LB / reverse proxy) |
| Certificate format | JKS keystore | N/A for API; PEM for connectors |
| Certificate config | `mirth.properties` (keystore path, password) | Reverse proxy config or K8s Ingress |
| Restart on cert rotation | Yes (Jetty reloads keystore) | No (proxy handles rotation independently) |
| Mutual TLS (API) | Configurable via Jetty | Configurable at proxy layer |
| Health probes | HTTPS (requires cert trust) | Plain HTTP (no cert needed) |

### Benefits of the HTTP-Only Pattern

- **No restart on certificate rotation.** When Let's Encrypt or an internal CA issues a new certificate, the proxy picks it up without touching the Mirth process. Java Mirth requires a Jetty restart or keystore reload.
- **Centralized certificate management.** All TLS configuration lives in one place (the proxy or cloud LB), not scattered across application config files.
- **Standard infrastructure tooling.** cert-manager, AWS ACM, GCP Managed Certificates, and Azure Key Vault all integrate natively with load balancers and ingress controllers -- no application-level plugin needed.
- **Simpler health checks.** Kubernetes readiness/liveness probes at `/api/health` and `/api/health/live` work over plain HTTP, avoiding the need to trust a self-signed cert in probe configuration.
- **Consistent with container-native patterns.** The same pattern used by most modern services running in Kubernetes, ECS, Cloud Run, and similar platforms.

> **If you must terminate TLS at the application level** (e.g., single-server deployment without a reverse proxy), see the [Optional Built-In HTTPS](#optional-built-in-https) section in Quick Reference. Set `TLS_CERT` and `TLS_KEY` environment variables pointing to PEM files.

---

## 2. Reverse Proxy Setup

### nginx

The following nginx configuration provides HTTPS termination with WebSocket passthrough for the dashboard status and server log WebSocket endpoints.

```nginx
upstream mirth_api {
    server 127.0.0.1:8080;
    # For multiple instances behind a single nginx:
    # server mirth-1:8080;
    # server mirth-2:8080;
}

server {
    listen 443 ssl;
    server_name mirth.example.com;

    ssl_certificate     /etc/nginx/ssl/mirth.crt;
    ssl_certificate_key /etc/nginx/ssl/mirth.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # API and static content
    location / {
        proxy_pass http://mirth_api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket endpoints (dashboard status + server log)
    location /ws/ {
        proxy_pass http://mirth_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;  # Keep WebSocket alive for 24h
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name mirth.example.com;
    return 301 https://$host$request_uri;
}
```

Key points:
- The `/ws/` location block handles both `/ws/dashboardstatus` and `/ws/serverlog`.
- `proxy_read_timeout 86400s` prevents nginx from closing idle WebSocket connections.
- `X-Forwarded-Proto` is used by the application to set the `Secure` flag on session cookies when `TLS_ENABLED=true`.

### Kubernetes Ingress with cert-manager

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: mirth-ingress
  namespace: mirth-production
  annotations:
    # cert-manager issues and renews certificates automatically
    cert-manager.io/cluster-issuer: letsencrypt-prod
    # nginx ingress controller settings
    nginx.ingress.kubernetes.io/proxy-read-timeout: "86400"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "86400"
    nginx.ingress.kubernetes.io/websocket-services: "node-mirth"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - mirth.example.com
      secretName: mirth-tls-cert
  rules:
    - host: mirth.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: node-mirth
                port:
                  number: 8080
```

The cert-manager annotation `cert-manager.io/cluster-issuer: letsencrypt-prod` triggers automatic certificate issuance and renewal. The certificate is stored in the Kubernetes Secret `mirth-tls-cert` and mounted by the ingress controller -- the Mirth pods never see the TLS certificate.

### AWS Application Load Balancer (ALB)

- Create an HTTPS listener on port 443 with an ACM certificate.
- Forward to a target group pointing at Mirth instances on port 8080 (HTTP).
- Enable stickiness if using in-memory session store (not needed with Redis sessions).
- For WebSocket support, ensure the target group protocol is HTTP (ALB natively supports WebSocket upgrade over HTTP targets).

```
ALB (443/HTTPS) --> Target Group (8080/HTTP) --> Mirth pods
```

### GCP HTTPS Load Balancer

- Create a Google-managed certificate or upload your own.
- Configure a backend service pointing to a Network Endpoint Group (NEG) or instance group on port 8080.
- GCP HTTPS LB natively supports WebSocket via the same HTTP/2 backend.

### Azure Application Gateway

- Create an HTTPS listener with a certificate from Azure Key Vault.
- Configure a backend pool pointing to Mirth instances on port 8080.
- Set the backend protocol to HTTP.
- Enable WebSocket support in the Application Gateway settings (enabled by default on v2 SKU).

---

## 3. Connector TLS

While the REST API uses infrastructure-level TLS, **connectors** that communicate with external systems handle TLS at the application level. This is necessary because healthcare protocols like MLLP operate over raw TCP sockets that the reverse proxy does not mediate.

### TCP/MLLP Connector (MLLPS)

TCP connectors support TLS via the `TlsProperties` interface defined in `src/connectors/tcp/TcpConnectorProperties.ts`. When TLS is enabled on a TCP receiver, it creates a `tls.Server` instead of a plain `net.Server`, and the transport type is reported as `MLLPS` (for MLLP mode) or `TCP+TLS` (for RAW/FRAME modes).

**Receiver (source connector) TLS configuration:**

```typescript
{
  tls: {
    enabled: true,
    keyStorePath: '/etc/mirth/certs/server.key',     // PEM private key
    certStorePath: '/etc/mirth/certs/server.crt',     // PEM certificate
    trustStorePath: '/etc/mirth/certs/ca.crt',        // PEM CA bundle (for mTLS)
    rejectUnauthorized: true,                          // Reject invalid client certs
    requireClientCert: true,                           // Enable mTLS
    minVersion: 'TLSv1.2',                            // Minimum TLS version
  }
}
```

**Dispatcher (destination connector) TLS configuration:**

```typescript
{
  tls: {
    enabled: true,
    keyStorePath: '/etc/mirth/certs/client.key',      // Client key (for mTLS)
    certStorePath: '/etc/mirth/certs/client.crt',     // Client cert (for mTLS)
    trustStorePath: '/etc/mirth/certs/ca.crt',        // Trusted CA
    rejectUnauthorized: true,                          // Validate server cert
    sniServerName: 'hl7.hospital.org',                // SNI hostname
  }
}
```

**TlsProperties fields:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable TLS for this connector |
| `keyStorePath` | string | - | Path to PEM private key file |
| `certStorePath` | string | - | Path to PEM certificate file |
| `trustStorePath` | string | - | Path to PEM CA certificate file |
| `rejectUnauthorized` | boolean | `true` | Reject connections with untrusted certificates |
| `requireClientCert` | boolean | `false` | Require client certificate (mTLS, receiver only) |
| `requireClientAuth` | boolean | `false` | Alias for `requireClientCert` (Java Mirth naming) |
| `sniServerName` | string | - | SNI server name for TLS connections |
| `minVersion` | string | - | Minimum TLS version (e.g., `TLSv1.2`) |
| `passphrase` | string | - | Passphrase for encrypted private keys |

### DICOM Connector

DICOM TLS is configured via the `DicomTlsMode` enum defined in `src/connectors/dicom/DICOMReceiverProperties.ts`:

| Mode | Value | Description |
|------|-------|-------------|
| `NO_TLS` | `notls` | No encryption (default) |
| `TLS_3DES` | `3des` | TLS with 3DES cipher suite |
| `TLS_AES` | `aes` | TLS with AES cipher suite |

DICOM TLS uses Java-style keystore/truststore paths configured in the receiver and dispatcher properties:

```typescript
// DICOM Receiver TLS properties
{
  tls: 'aes',                    // DicomTlsMode value
  keyStore: '/etc/mirth/certs/dicom-keystore.p12',
  keyStorePW: 'changeit',
  keyPW: 'changeit',
  trustStore: '/etc/mirth/certs/dicom-truststore.p12',
  trustStorePW: 'changeit',
  noClientAuth: false,           // Require client certificates
  nossl2: true,                  // Disable SSLv2
}
```

The `DicomConnection` class in `src/connectors/dicom/DicomConnection.ts` uses Node.js `tls.connect()` when the TLS mode is not `NO_TLS`.

### SMTP Connector

SMTP encryption is configured via the `SmtpEncryption` type defined in `src/connectors/smtp/SmtpDispatcherProperties.ts`:

| Mode | Port | Description |
|------|------|-------------|
| `none` | 25 | No encryption |
| `tls` | 587 | STARTTLS (upgrade from plain to TLS) |
| `ssl` | 465 | Implicit TLS (connection starts encrypted) |

Example configuration:

```typescript
{
  smtpHost: 'smtp.example.com',
  smtpPort: '587',
  encryption: 'tls',            // STARTTLS
  authentication: true,
  username: 'mirth@example.com',
  password: '${SMTP_PASSWORD}', // Use env var via VariableResolver
}
```

The Node.js SMTP dispatcher uses [nodemailer](https://nodemailer.com/), which handles STARTTLS negotiation and implicit SSL natively.

### HTTP Sender (Destination)

The HTTP dispatcher in `src/connectors/http/HttpDispatcher.ts` uses Node.js `https.Agent` for connection pooling when the destination URL starts with `https://`. No additional TLS configuration is needed -- the dispatcher automatically uses HTTPS when the URL scheme requires it. The `https.Agent` respects `NODE_EXTRA_CA_CERTS` for custom CA bundles.

### Converting Java Keystores to PEM

Java Mirth stores certificates in JKS (Java KeyStore) format. Node.js connectors use PEM files. Use these commands to convert:

**Extract private key and certificate from a JKS keystore:**

```bash
# Step 1: Convert JKS to PKCS12
keytool -importkeystore \
  -srckeystore mirth-keystore.jks \
  -srcstorepass changeit \
  -destkeystore mirth-keystore.p12 \
  -deststoretype PKCS12 \
  -deststorepass changeit

# Step 2: Extract private key from PKCS12
openssl pkcs12 -in mirth-keystore.p12 \
  -passin pass:changeit \
  -nocerts -nodes \
  -out server.key

# Step 3: Extract certificate from PKCS12
openssl pkcs12 -in mirth-keystore.p12 \
  -passin pass:changeit \
  -nokeys \
  -out server.crt
```

**Extract CA certificate from a JKS truststore:**

```bash
# List aliases in the truststore
keytool -list -keystore mirth-truststore.jks -storepass changeit

# Export a specific CA certificate
keytool -exportcert \
  -keystore mirth-truststore.jks \
  -storepass changeit \
  -alias myca \
  -rfc \
  -file ca.crt
```

**Verify the extracted PEM files:**

```bash
# Check private key
openssl rsa -in server.key -check -noout

# Check certificate details
openssl x509 -in server.crt -text -noout

# Verify key matches certificate
diff <(openssl x509 -in server.crt -pubkey -noout) \
     <(openssl rsa -in server.key -pubout 2>/dev/null)
```

---

## 4. Cluster Security

### Inter-Instance Authentication

When cluster mode is enabled (`MIRTH_CLUSTER_ENABLED=true`), Node.js Mirth instances communicate via the internal dispatch endpoint `POST /api/internal/dispatch`. This endpoint is secured with a shared secret configured via the `MIRTH_CLUSTER_SECRET` environment variable.

The secret is transmitted as an HTTP header:

```
X-Cluster-Secret: <value of MIRTH_CLUSTER_SECRET>
```

The `RemoteDispatcher` middleware in `src/cluster/RemoteDispatcher.ts` validates this header on every request to `/api/internal/*`. If the header is missing or does not match, the request is rejected with HTTP 403.

**Setting the cluster secret:**

```bash
# Generate a strong random secret
export MIRTH_CLUSTER_SECRET=$(openssl rand -base64 32)

# All instances in the cluster MUST use the same value
```

In Kubernetes, store the secret in a K8s Secret and reference it in the deployment:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: mirth-cluster-secret
  namespace: mirth-production
type: Opaque
stringData:
  cluster-secret: "your-strong-random-secret-here"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: node-mirth
spec:
  template:
    spec:
      containers:
        - name: node-mirth
          env:
            - name: MIRTH_CLUSTER_SECRET
              valueFrom:
                secretKeyRef:
                  name: mirth-cluster-secret
                  key: cluster-secret
```

### Encrypted Pod-to-Pod Traffic

The `MIRTH_CLUSTER_SECRET` provides authentication but not encryption of the inter-instance traffic. For encrypted pod-to-pod communication, use a service mesh:

- **Istio**: Enables automatic mTLS between all pods in the mesh. No application changes required. Sidecar proxy encrypts traffic transparently.
- **Linkerd**: Lightweight alternative with automatic mTLS. Lower resource overhead than Istio.

With a service mesh, the internal dispatch traffic (`POST /api/internal/dispatch`) is encrypted at the network layer, and the `MIRTH_CLUSTER_SECRET` provides an additional authentication layer.

Without a service mesh, internal traffic between pods is unencrypted. In environments where this is a compliance concern (HIPAA, SOC 2), deploy a service mesh or use a network policy that restricts traffic to the mirth namespace.

### Redis TLS

If using Redis for shared session storage or cluster event bus (`MIRTH_CLUSTER_REDIS_URL`), use a `rediss://` URL scheme to enable TLS:

```bash
# Plain Redis (unencrypted)
MIRTH_CLUSTER_REDIS_URL=redis://redis-host:6379

# Redis with TLS
MIRTH_CLUSTER_REDIS_URL=rediss://redis-host:6380
```

---

## 5. Certificate Management

### Certificate Sources

| Source | Use Case | Automation |
|--------|----------|------------|
| Let's Encrypt (via cert-manager) | Public-facing API endpoints | Fully automated issuance and renewal |
| Internal CA (e.g., HashiCorp Vault, Active Directory CS) | Internal MLLP/DICOM endpoints | Automated via Vault agent or cert-manager Vault issuer |
| Self-signed | Development and testing only | Manual (see test cert generation below) |
| Cloud-managed (AWS ACM, GCP, Azure) | Cloud load balancer termination | Automated renewal by cloud provider |

### Kubernetes Secret Mounting for Connector Certs

Connector TLS certificates (for MLLP, DICOM, etc.) need to be available as files inside the container. Mount them from Kubernetes Secrets:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: mirth-connector-certs
  namespace: mirth-production
type: kubernetes.io/tls
data:
  tls.crt: <base64-encoded certificate>
  tls.key: <base64-encoded private key>
  ca.crt: <base64-encoded CA certificate>
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: node-mirth
spec:
  template:
    spec:
      containers:
        - name: node-mirth
          volumeMounts:
            - name: connector-certs
              mountPath: /etc/mirth/certs
              readOnly: true
      volumes:
        - name: connector-certs
          secret:
            secretName: mirth-connector-certs
```

Then reference the mounted paths in connector configuration:

```typescript
{
  tls: {
    enabled: true,
    keyStorePath: '/etc/mirth/certs/tls.key',
    certStorePath: '/etc/mirth/certs/tls.crt',
    trustStorePath: '/etc/mirth/certs/ca.crt',
  }
}
```

### Certificate Rotation

| Certificate Type | Rotation Strategy | Restart Required |
|------------------|-------------------|------------------|
| Reverse proxy / Ingress certs | Proxy or ingress controller reloads automatically | No (Mirth is unaware) |
| Connector TLS certs (MLLP, DICOM) | Update the K8s Secret; restart affected channels | Yes -- channel restart |
| Cluster secret (`MIRTH_CLUSTER_SECRET`) | Rolling update of all instances | Yes -- pod restart |
| Redis TLS | Update Redis client config | Yes -- pod restart |

**Rotating connector certificates without full server restart:**

```bash
# 1. Update the Kubernetes Secret
kubectl create secret tls mirth-connector-certs \
  --cert=new-server.crt \
  --key=new-server.key \
  --dry-run=client -o yaml | kubectl apply -f -

# 2. Wait for the Secret to propagate to pods (kubelet sync period, typically <1 min)
sleep 60

# 3. Restart only the affected channels via the API
# (The channel restart reloads the cert files from disk)
curl -X POST http://localhost:8080/api/channels/<channelId>/_stop \
  -H "X-Session-ID: <session>"
curl -X POST http://localhost:8080/api/channels/<channelId>/_start \
  -H "X-Session-ID: <session>"

# Or via CLI:
mirth-cli channels stop "MLLPS Receiver"
mirth-cli channels start "MLLPS Receiver"
```

### Generating Self-Signed Certificates for Development

```bash
# Create a temporary CA
openssl genrsa -out ca.key 2048
openssl req -new -x509 -key ca.key -out ca.crt -days 365 \
  -subj "/CN=Mirth Dev CA"

# Create server certificate signed by the CA
openssl genrsa -out server.key 2048
openssl req -new -key server.key -out server.csr \
  -subj "/CN=localhost"

# Sign with SAN extension (required for modern TLS clients)
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out server.crt -days 365 \
  -extfile <(printf "subjectAltName=DNS:localhost,IP:127.0.0.1")

# Create client certificate for mTLS testing
openssl genrsa -out client.key 2048
openssl req -new -key client.key -out client.csr \
  -subj "/CN=Mirth Client"
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out client.crt -days 365
```

### Testing TLS Connectivity

```bash
# Test HTTPS through a reverse proxy
openssl s_client -connect mirth.example.com:443 \
  -servername mirth.example.com </dev/null 2>/dev/null | \
  openssl x509 -noout -dates -subject

# Test MLLPS connector directly
openssl s_client -connect localhost:6661 </dev/null 2>/dev/null | \
  openssl x509 -noout -dates -subject

# Test with a specific CA bundle
openssl s_client -connect localhost:6661 \
  -CAfile /etc/mirth/certs/ca.crt </dev/null

# Test mTLS (present client certificate)
openssl s_client -connect localhost:6661 \
  -cert client.crt -key client.key \
  -CAfile ca.crt </dev/null

# Verify a DICOM TLS endpoint
openssl s_client -connect pacs.hospital.org:2762 \
  -CAfile /etc/mirth/certs/dicom-ca.crt </dev/null

# Check which TLS versions are supported
nmap --script ssl-enum-ciphers -p 6661 localhost
```

---

## 6. Quick Reference

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TLS_ENABLED` | `false` | When `true`, sets the `Secure` flag on session cookies (`JSESSIONID`). Set this when running behind an HTTPS reverse proxy so that cookies are only sent over encrypted connections. Also set automatically when `NODE_ENV=production`. |
| `NODE_EXTRA_CA_CERTS` | (none) | Path to a PEM file containing additional CA certificates trusted by the Node.js process. Applied globally -- affects HTTP dispatcher HTTPS requests, Redis TLS connections, and any other outbound TLS from the application. Standard Node.js environment variable. |
| `MIRTH_CLUSTER_SECRET` | (none) | Shared secret for inter-instance API authentication. Used as the `X-Cluster-Secret` header on `POST /api/internal/dispatch` requests. All cluster instances must share the same value. |
| `TLS_CERT` | (none) | Path to a PEM certificate file for optional built-in HTTPS. When both `TLS_CERT` and `TLS_KEY` are set, the server creates an `https.Server` instead of an `http.Server`. Use this only when a reverse proxy is not available. |
| `TLS_KEY` | (none) | Path to a PEM private key file for optional built-in HTTPS. Must be set together with `TLS_CERT`. |
| `HTTPS_PORT` | `8443` | Port for built-in HTTPS when `TLS_CERT` and `TLS_KEY` are set. |

### Port Summary

| Port | Protocol | Component | TLS |
|------|----------|-----------|-----|
| 8080 | HTTP | REST API (default) | Terminated at proxy |
| 8443 | HTTPS | REST API (optional built-in) | Application-level |
| 6661+ | TCP/MLLP | TCP source connectors | Per-connector `TlsProperties` |
| 104 | DICOM | DICOM source connector | Per-connector `DicomTlsMode` |
| 25/465/587 | SMTP | SMTP destination connector | Per-connector `SmtpEncryption` |

### Decision Matrix

| Scenario | API TLS | Connector TLS | Cluster TLS |
|----------|---------|---------------|-------------|
| Single server, dev/test | Not needed | Self-signed certs | N/A |
| Single server, production | Reverse proxy (nginx) | Internal CA certs | N/A |
| Kubernetes, single replica | Ingress + cert-manager | K8s Secret mount | N/A |
| Kubernetes, clustered | Ingress + cert-manager | K8s Secret mount | `MIRTH_CLUSTER_SECRET` + service mesh |
| Cloud (AWS/GCP/Azure) | Cloud LB + managed cert | Internal CA certs | `MIRTH_CLUSTER_SECRET` + VPC |

### Optional Built-In HTTPS

For deployments without a reverse proxy, the server can terminate TLS directly:

```bash
# Generate or obtain PEM certificate and key, then:
TLS_CERT=/etc/mirth/certs/server.crt \
TLS_KEY=/etc/mirth/certs/server.key \
HTTPS_PORT=8443 \
node dist/index.js
```

When `TLS_CERT` and `TLS_KEY` are both set, the server binds to `HTTPS_PORT` (default 8443) using `https.createServer()`. The plain HTTP port (`PORT`, default 8080) continues to serve health check endpoints for orchestrator probes that cannot be configured with TLS trust.

> **Recommendation:** Prefer the reverse proxy pattern for production. Built-in HTTPS is provided as a convenience for edge cases (single-server deployments, appliance mode) where adding a proxy introduces unnecessary complexity.
