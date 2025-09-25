FROM node:18-alpine

WORKDIR /app

# Cache buster - forces rebuild of subsequent layers
ARG BUILD_REV=default
RUN echo "BUILD_REV=${BUILD_REV}" > /build-rev.txt

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Expose the port
EXPOSE $PORT

# Start the application
CMD ["npm", "run", "start:production"]