FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src

EXPOSE 4000

# Run migrations, seed, then start
# Tambahkan dulu nilai enum PARTIAL ke DB (aman/idempotent) SEBELUM `prisma db push`,
# supaya db push tidak mencoba membangun ulang enum BillStatus (yang gagal kalau ada
# baris memakai 'PARTIAL'). Lalu sinkronkan schema, seed, dan jalankan server.
CMD ["sh", "-c", "node prisma/ensure-enum.js && npx prisma db push --accept-data-loss && node prisma/seed.js && node src/index.js"]
