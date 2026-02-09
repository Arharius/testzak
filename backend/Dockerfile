FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
# Playwright needs these to run browsers
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first to cache pip install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright browsers (chromium only to save space)
RUN playwright install chromium --with-deps

# Copy application code
COPY . .

# Create temp directory for doc generation
RUN mkdir -p temp

# Expose port
EXPOSE 8000

# Command to run the app
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
