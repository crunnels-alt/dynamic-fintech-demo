FROM node:18-alpine

WORKDIR /app

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