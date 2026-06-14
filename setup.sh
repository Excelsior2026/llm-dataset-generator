#!/bin/bash
echo "🚀 Preparing TrainEngine.ai for installation..."

# 1. Install dependencies
echo "📦 Installing Node.js dependencies..."
npm install

# 2. Create .env file if it doesn't exist
if [ ! -f .env ]; then
  echo "📝 Creating .env file. Please add your GEMINI_API_KEY inside it."
  echo "GEMINI_API_KEY=your_key_here" > .env
fi

# 3. Build the project
echo "🔨 Building production assets..."
npm run build

# 4. Package into executable
echo "📦 Packaging into desktop application..."
npm run electron:build

echo "✅ Setup Complete! You can find your executable in the /build folder."
