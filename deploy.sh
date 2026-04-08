rsync -avz /Users/eringen/projects/talkdom_site/ hiredgun@eringen.com:/opt/talkdom_site/ --exclude node_modules --exclude .claude
cd /opt/talkdom_site/ && npm install && npx tailwindcss -i css/input.css -o dist/tailwind.css --minify
