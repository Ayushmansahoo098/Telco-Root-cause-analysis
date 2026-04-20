FROM node:20-alpine AS frontend

WORKDIR /frontend

COPY package.json package-lock.json vite.config.js tailwind.config.js postcss.config.js index.html ./
COPY src ./src

RUN npm ci
RUN npm run build

FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=7860

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY app/ ./app/
COPY server/ ./server/
COPY inference.py .
COPY --from=frontend /frontend/app/static ./app/static

# Expose port
EXPOSE 7860

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=5 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen('http://localhost:%s/ready' % os.getenv('PORT', '7860'))"

CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860} --proxy-headers --forwarded-allow-ips='*'"]
