# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Version scheme: `JAVA_VERSION-port.N` where N is the port iteration counter.

## [3.9.1-port.0] (2026-02-22)

**Java Mirth Version:** 3.9.1

### Features

* Complete Node.js/TypeScript replacement for Mirth Connect Java engine
* 10 connector types: HTTP, TCP/MLLP, File/SFTP/S3, JDBC, VM, SMTP, JMS, WebService, DICOM
* 9 data types: HL7v2, XML, JSON, Raw, Delimited, EDI/X12, HL7v3, NCPDP, DICOM
* E4X transpilation engine with full XMLProxy implementation
* 20 REST API servlets with role-based authorization
* Dual operational modes: takeover (existing Java DB) and standalone (fresh schema)
* Shadow mode for safe progressive cutover from Java Mirth
* Container-native horizontal scaling with database-backed lease coordination
* Git-backed artifact management with environment promotion and delta deploys
* Interactive CLI dashboard with real-time WebSocket updates
* Cross-channel message trace API and CLI
* OpenTelemetry auto-instrumentation with custom metrics and Prometheus scrape
* Centralized logging with runtime log level control via REST API
* Data pruner with per-channel settings and archive-before-delete
* Kubernetes deployment with Kustomize overlays for all 4 operational modes

### Infrastructure

* 8,690+ automated tests (381 unit suites, 13 integration suites)
* Conventional commits with commitlint enforcement
* GitHub Actions CI/CD pipeline
* Automated release process with dual-version tracking
