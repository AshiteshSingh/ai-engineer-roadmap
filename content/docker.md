# Docker

## The 30-Second Pitch
Docker is a platform for developing, shipping, and running applications in lightweight, portable containers. It solves the "it works on my machine" problem by packaging an application with all its dependencies—code, runtime, system tools, libraries, and settings—into a standardized unit. Teams pick Docker over traditional virtualization because containers share the host OS kernel, making them faster to start, more resource-efficient, and smaller in size than virtual machines. For a Senior Full Stack AI Engineer, it's the foundational tool for ensuring consistent environments from a local LlamaIndex prototype to a scalable microservice deployment on AWS, Azure, or GCP, and it's the primary building block for Kubernetes-based orchestration.

## How It Actually Works
The core mental model is the separation of concerns between the Docker Engine (the runtime), Images (the immutable blueprint), and Containers (the running instance).

**Key Internals & Architecture:**
1.  **Client-Server Architecture:** The `docker` CLI talks to the Docker Daemon (`dockerd`), a long-running background service that manages images, containers, networks, and volumes. They communicate via a REST API, often over a Unix socket (`/var/run/docker.sock`) or a TCP port.
2.  **The Image:** A layered, read-only filesystem. Each instruction in a `Dockerfile` (e.g., `FROM`, `RUN`, `COPY`) creates a new layer. Layers are cached and shared between images, making builds efficient. The final image is tagged (e.g., `myapp:v1.0`) and stored in a Registry (Docker Hub, Amazon ECR, Azure Container Registry).
3.  **The Container:** A runnable instance of an image. When you run `docker run`, the daemon adds a thin, writable "container layer" on top of the image's read-only layers using a Union File System (like `overlay2`). This is where any file changes during runtime live. The container gets its own isolated process space, network stack, and mount namespace.
4.  **Namespaces & cgroups:** These are Linux kernel features Docker leverages for isolation.
    *   **Namespaces** (PID, NET, MNT, IPC, UTS) provide isolated workspaces (containers). For example, the PID namespace gives a container its own process tree starting at PID 1.
    *   **Control Groups (cgroups)** limit and account for resource usage (CPU, memory, disk I/O, network) per container. This is how you set `--memory=2g`.
5.  **Data Flow:** A developer writes a `Dockerfile`. The Docker CLI sends build context to the daemon, which executes the instructions layer-by-layer to create an image. The image is pushed to a registry. In production, the daemon pulls the image and creates a container from it, applying runtime constraints (resource limits, network config, volume mounts).

```
[Developer Machine]
    |
    | (docker build/push)
    v
[Docker Daemon] <-----> [Container Registry (ECR/ACR/GCR)]
    |  (Manages)
    |
[Container] (Namespace/cgroup isolation)
    |  |
    |  +---> Writable Layer
    |  +---> Image Layers (ubuntu, python, app code...)
    |
[Host OS Kernel (Linux/Windows)]
    |
[Infrastructure (AWS EC2, Azure VM, etc.)]
```

## Patterns You Should Know

### 1. Multi-Stage Builds for Lean Production Images
Critical for production, especially with compiled languages or Node.js applications with heavy build dependencies. It keeps the final image small and secure by discarding build tools.

```dockerfile
# Stage 1: The Builder
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
# Copy source and build if needed (e.g., TypeScript)
COPY src ./src
# RUN npm run build # Uncomment for TS/React etc.

# Stage 2: The Runner
FROM node:18-alpine
WORKDIR /app
# Copy only the necessary artifacts from the builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/src ./src # Or /app/dist if built
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
```

### 2. Docker Compose for Local Development Stacks
Orchestrates multi-container applications (app + database + cache + AI model server). Essential for replicating a microservice or full-stack AI environment locally.

```yaml
# docker-compose.yml
version: '3.8'
services:
  ai-backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      - REDIS_URL=redis://redis:6379
      - MODEL_PATH=/models/llama2
    volumes:
      - ./backend/src:/app/src # Live code reload
      - ./models:/models # Mount pre-downloaded AI models
    depends_on:
      - redis
      - model-server

  model-server:
    image: ghcr.io/llama-index/llama-index-server:latest
    ports:
      - "8080:8080"
    volumes:
      - ./models:/models

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data

volumes:
  redis_data:
```

### 3. Healthchecks and Graceful Shutdown
Production containers must be robust. A healthcheck lets the orchestrator (Kubernetes, ECS) know if the app is alive. Handling SIGTERM ensures graceful shutdown.

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

# Define a healthcheck (critical for K8s liveness/readiness probes)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:5000/health || exit 1

# Use a wrapper script for graceful shutdown
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh
ENTRYPOINT ["./entrypoint.sh"]
```

```bash
#!/bin/bash
# entrypoint.sh
# Trap SIGTERM and gracefully stop the app
trap 'echo "SIGTERM received, shutting down..."; kill -TERM $PID; wait $PID' TERM

python app.py &
PID=$!
wait $PID
```

### 4. Non-Root User and Security Hardening
Running as root inside a container is a security risk. Always switch to a non-root user.

```dockerfile
FROM ubuntu:22.04
RUN apt-get update && apt-get install -y python3 python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r appuser && useradd -r -g appuser appuser

WORKDIR /home/appuser
COPY --chown=appuser:appuser . .
RUN pip3 install --no-cache-dir -r requirements.txt

USER appuser # Switch to non-root user for execution
EXPOSE 8000
CMD ["python3", "app.py"]
```

### 5. Efficient Layer Caching and .dockerignore
Optimizing build speed and image size is a hallmark of seniority. Order Dockerfile instructions from least to most frequently changing and use a `.dockerignore` file.

```dockerfile
# .dockerignore
node_modules
npm-debug.log
.git
.gitignore
.env
*.pyc
__pycache__
.DS_Store
README.md
tests/
# Ignore large model files unless specifically copied
models/*.bin
```

```dockerfile
# Dockerfile - Optimized for cache
# 1. Install OS dependencies (changes infrequently)
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev && rm -rf /var/lib/apt/lists/*

# 2. Install Python dependencies (cache breaks when requirements.txt changes)
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 3. Copy application code (changes most frequently)
COPY . .
```

## What Interviewers Actually Ask

**Q: Explain what happens when you run `docker run -it ubuntu bash`.**
**A:** The Docker daemon checks locally for the `ubuntu:latest` image. If not found, it pulls it from Docker Hub. It creates a new container with a writable layer atop the image layers, allocates a pseudo-TTY (`-t`), keeps STDIN open (`-i`), and sets the command to `bash`. It uses namespaces to isolate the container's process tree and network, and cgroups to apply default resource limits. The container runs until `bash` exits.

**Q: What's the difference between `COPY` and `ADD` in a Dockerfile? When would you use each?**
**A:** `COPY` is straightforward: it copies local files/directories from the build context into the image. `ADD` has extra features: it can copy from remote URLs and automatically extract local tar archives. The best practice is to always use `COPY` unless you specifically need the tar extraction or remote URL functionality of `ADD`, as its behavior is less predictable and transparent.

**Q: How do Docker containers communicate with each other on the same host?**
**A:** By default, Docker creates a bridge network (`docker0`). Each container gets a virtual Ethernet interface attached to this bridge and an IP address. Containers can communicate using these internal IPs. For better service discovery, you should create a user-defined bridge network (`docker network create mynet`). Containers attached to the same user-defined network can communicate using their container names as hostnames, and Docker provides an embedded DNS server to resolve these names.

**Q: When would you choose Docker over a full VM, and when might a VM be better?**
**A:** Choose Docker for application portability, fast startup, high density (running many instances on one host), and microservice architectures. It's ideal for stateless services, CI/CD pipelines, and packaging dependencies. Choose a VM when you need to run a full OS with a different kernel (e.g., Windows on Linux), for strict security isolation (though containers can be secure, VMs offer a stronger boundary), or for legacy applications that require specific kernel modules or modifications.

**Q: You have a containerized Node.js application that's crashing intermittently in production. What's your debugging strategy using Docker?**
**A:** First, I'd check the container logs: `docker logs <container_id> --tail 50 -f`. Then, I'd inspect the container's resource usage at the time of crash using `docker stats` history or the host's monitoring. If logs aren't enough, I'd examine the container's metadata and state with `docker inspect <container_id>`. For a deeper dive, I might commit the state of a failing container to a new image (`docker commit`) for offline analysis, or if possible, exec into a running container (`docker exec -it <container_id> sh`) to check process lists, memory, and internal logs. The goal is to correlate the crash with resource limits (OOM Killer), application errors, or external dependencies.

**Q: How do you manage persistent data (like a database) with Docker containers?**
**A:** Containers are ephemeral. For persistent data, you must use Docker Volumes or bind mounts. **Volumes** are managed by Docker and stored in a host directory (`/var/lib/docker/volumes/`). They are the preferred mechanism because they can be named, easily backed up, and managed by Docker CLI. **Bind mounts** mount a specific host path into the container. They offer higher performance but tie the container to a specific host's filesystem layout. For a database, you'd define a volume in your `docker run` command or Compose file: `-v db_data:/var/lib/postgresql/data`. Never store data in the container's writable layer.

**Q: How does Docker fit into a CI/CD pipeline for a microservice?**
**A:** Docker is the consistent packaging format throughout the pipeline. In CI, the pipeline builds a Docker image from the application code, tags it with the commit SHA (e.g., `myapp:git-abc123`), and runs unit/integration tests inside a container. If tests pass, it might scan the image for vulnerabilities. In CD, the pipeline pushes the validated image to a production registry (ECR). The deployment system (Kubernetes, ECS) is then instructed to update the deployment to use the new image tag. This ensures the artifact tested is identical to the one deployed.

**Q: Explain the relationship between Docker and Kubernetes.**
**A:** Docker is a containerization platform used to build, package, and run individual containers. Kubernetes is a container *orchestration* platform. It uses Docker (or other runtimes like containerd) as its underlying container runtime to pull images and run containers. Kubernetes then manages the lifecycle of these containers at scale: scheduling them across a cluster of machines, ensuring desired replica counts, handling load balancing, service discovery, and rolling updates. Think of Docker as the "what" (the application package) and Kubernetes as the "where and how many" (the cluster scheduler and manager).

## How It Connects to This Role's Stack
As a Senior Full Stack AI Engineer at WWT, Docker is the linchpin that connects all the pieces of your stack into a reproducible, deployable unit.

*   **LlamaIndex/Node.js (Application Layer):** You'll containerize your AI application logic—whether it's a Node.js API using LlamaIndex for RAG or a Python model server. Multi-stage builds keep these images lean. You'll mount volumes for vector indexes or model weights that are too large for the image itself.
*   **AWS/Azure/GCP (Cloud Providers):** Docker images are the universal deployment artifact. You'll push them to the cloud's managed container registry (ECR, ACR, GCR). These images then run on managed services like AWS ECS, Azure Container Instances, or Google Cloud Run, or as the fundamental unit deployed onto Kubernetes clusters (EKS, AKS, GKE) provisioned on these clouds.
*   **CI/CD:** Your pipeline (Jenkins, GitLab CI, GitHub Actions) will use Docker to create a consistent environment for running tests, linters, and security scans. The final build step is always creating a Docker image.
*   **Microservices:** Docker is the primary packaging format for each microservice. Docker Compose is used for local development of the entire service mesh, while in production, Kubernetes manages the networking and discovery between these containerized services.
*   **Kubernetes:** This is the direct successor. You don't just "use Docker"; you build Docker images that are deployed and managed by Kubernetes. Understanding Docker's image, layer, and networking model is prerequisite knowledge for debugging Kubernetes pods and understanding Pod specs.

## Red Flags to Avoid
*   **"I run everything as root in containers."** This shows a lack of security awareness. Always mention using the `USER` directive.
*   **"I use `latest` tag in production."** This is a recipe for instability. You should advocate for immutable, version-specific tags (e.g., `myapp:1.2.3-gitabc123`).
*   **"Data is stored inside the container."** Confusing the ephemeral container layer with persistent storage is a fundamental mistake. You must mention volumes.
*   **"Docker is a lightweight VM."** While a common analogy, it's technically imprecise. A strong candidate explains it uses kernel namespaces and cgroups for isolation, not a hypervisor.
*   **Not knowing about `.dockerignore`.** This leads to bloated build contexts and images, and potentially leaking secrets.
*   **Using `docker commit` as part of a build process.** This creates opaque, unreproducible images. The correct answer is always to define everything in a `Dockerfile`.
*   **"I don't need multi-stage builds for my Python/Node app."** For any production application, you should be thinking about minimizing attack surface and image size. Mentioning multi-stage builds (even if just to separate `dev` vs `prod` dependencies) shows depth.
*   **Confusing Docker Swarm with Kubernetes in a modern cloud context.** While Swarm exists, for a role mentioning AWS/Azure/GCP, the assumed orchestration tool is Kubernetes. Focus your answers on that integration.