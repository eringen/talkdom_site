css:
	npx tailwindcss -i css/input.css -o dist/tailwind.css --watch

css-prod:
	npx tailwindcss -i css/input.css -o dist/tailwind.css --minify

serve:
	python3 -m http.server 3000
