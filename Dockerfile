# Dockerfile
# Use the official Node.js image as the base image
FROM node:18-alpine

# Install docker
RUN apk add --no-cache docker-cli docker-compose

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the source code
COPY . .

# Build the TypeScript code
RUN npm run build

# Expose the port that Fastify will run on
EXPOSE 3000

# Start the Fastify server
CMD ["npm", "run", "start"]
