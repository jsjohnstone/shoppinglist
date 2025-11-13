# Multi-stage build for production

# Stage 1: Build frontend
FROM node:18-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Production image
FROM node:18-alpine

# Install PostgreSQL client tools for migrations
RUN apk add --no-cache postgresql-client

# Create app directory
WORKDIR /app

# Copy backend package files
COPY package*.json ./
RUN npm install --production

# Copy backend code
COPY backend/ ./backend/
COPY drizzle.config.js ./

# Copy database migrations
COPY drizzle/ ./drizzle/

# Copy frontend build
COPY --from=frontend-builder /app/frontend/dist ./public

# Expose port
EXPOSE 3000

# Start the application
CMD ["sh", "-c", "sleep 10 && npm run migrate && NODE_ENV=production node backend/server.js"]
