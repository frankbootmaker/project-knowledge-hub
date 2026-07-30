# Bake Ops-0 scripts into the image so Dokploy redeploys cannot orphan the
# bind mount (git checkout is replaced while a long-sleeping db-backup keeps an
# old mount → /scripts/backup-db.sh: No such file or directory).
FROM pgvector/pgvector:pg16

COPY infrastructure/scripts /scripts
RUN chmod +x /scripts/*.sh \
  && find /scripts/lib -type f -name '*.sh' -exec chmod +x {} \;

WORKDIR /scripts
ENTRYPOINT ["/bin/bash", "/scripts/backup-loop.sh"]
