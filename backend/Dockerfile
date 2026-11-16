FROM python:3.13-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /srv/backend
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY seed ./seed
# Work out the common answers for the latest race now, while there is CPU to spare; they ship inside the image
# as precomputed.db. Never fails the build: anything missing is computed on demand.
RUN APEX_DATA_DIR=/tmp/apex-precompute APEX_LIVE=0 python -m app.precompute || echo "precompute skipped"; rm -rf /tmp/apex-precompute
ENV APEX_DATA_DIR=/srv/data
VOLUME /srv/data
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
