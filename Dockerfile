FROM python:3.11-slim

# Install system build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Create user with UID 1000 for Hugging Face Spaces compatibility
RUN useradd -m -u 1000 user
USER user
ENV PATH="/home/user/.local/bin:$PATH"

WORKDIR /app

# Copy and install python dependencies
COPY --chown=user backend/requirements.txt requirements.txt
RUN pip install --no-cache-dir --upgrade -r requirements.txt

# Copy the application source code
COPY --chown=user . /app

# Expose the mandatory Hugging Face Space port
EXPOSE 7860

# Run FastAPI serving frontend and backend
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860"]
