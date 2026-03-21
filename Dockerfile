FROM node:20-slim AS frontend-build

WORKDIR /build
COPY frontend-react/package.json frontend-react/package-lock.json ./
RUN npm ci --ignore-scripts
COPY frontend-react/ ./
RUN npm run build

FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./

COPY --from=frontend-build /build/dist ./static

RUN mkdir -p templates output && chmod 777 templates output

ENV PYTHONUNBUFFERED=1
ENV PORT=8000

EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 2 --timeout-keep-alive 120"]
