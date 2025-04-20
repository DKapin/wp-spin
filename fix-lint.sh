#!/bin/bash

echo "🧹 Fixing linting errors..."

# Run eslint with auto-fix on all TypeScript files
npx eslint --fix "src/**/*.ts" "test/**/*.ts" "test/**/*.js"

# Fix specific issues in shell.ts, status.ts, and stop.ts
for file in src/commands/shell.ts src/commands/status.ts src/commands/stop.ts; do
  echo "Fixing Config type in $file"
  sed -i '' 's/config: any/config: Config/g' "$file"
  # Add Config import if not already present
  if ! grep -q "import { Config } from '@oclif/core'" "$file"; then
    sed -i '' '1s/^/import { Config } from '\''@oclif\/core'\'';\n/' "$file"
  fi
done

# Fix import order where possible
find src test -name "*.ts" -o -name "*.js" | xargs npx eslint --fix --quiet

echo "✅ Linting fixes applied! Some manual fixes may still be needed." 