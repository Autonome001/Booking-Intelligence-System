# Autonome.us Booking Agent Backend
FROM node:20-alpine

WORKDIR /app

# Copy root package files first
COPY package*.json ./

# Install root dependencies (without postinstall to avoid backend dependency issues)
RUN npm install --omit=dev --ignore-scripts --no-audit

# Copy backend package files
COPY backend/package*.json ./backend/

# Install backend dependencies
WORKDIR /app/backend
RUN npm install --omit=dev --no-audit

# Copy backend source code
COPY backend/ ./

# Switch back to app directory
WORKDIR /app

# Copy any other necessary files
COPY .railway-trigger ./

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

# Start command
CMD ["npm", "start"]