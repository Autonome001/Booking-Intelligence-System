# Autonome.us Booking Agent Backend
FROM node:20-alpine

WORKDIR /app

# Copy root package files first
COPY package*.json ./

# Install root dependencies (without postinstall to avoid backend dependency issues)
RUN npm install --ignore-scripts --no-audit

# Copy backend package files
COPY backend/package*.json ./backend/

# Install backend dependencies
WORKDIR /app/backend
RUN npm install --no-audit

# Copy backend source code
COPY backend/ ./

# Switch back to app directory
WORKDIR /app

# Copy shared source and config required for TypeScript build
COPY src ./src
COPY config ./config
COPY tsconfig.json ./

# Build the TypeScript server artifact
RUN npm run build

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

# Start command
CMD ["npm", "start"]
