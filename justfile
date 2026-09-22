set shell := ["bash", "-cu"]

# List available recipes
default:
    @just --list

# Install Ruby gem dependencies
install:
    bundle install

# Serve the site (livereload). Binds all interfaces so phones on the LAN can load it.
# Ex: just serve 4001    Ex: just serve 4000 127.0.0.1
serve port="4000" host="0.0.0.0":
    bundle exec jekyll serve --host {{host}} --port {{port}} --livereload

# Serve and open the yotein page in the default browser
yotein port="4000":
    @( sleep 2 && open "http://127.0.0.1:{{port}}/yotein/" ) &
    bundle exec jekyll serve --host 0.0.0.0 --port {{port}} --livereload

# Build the site to _site/ without serving
build:
    bundle exec jekyll build

# Remove _site/ and .jekyll-cache/
clean:
    bundle exec jekyll clean

# Regenerate _data/media.yml (video orientation + image dimensions)
media:
    node scripts/probe-media.mjs

# Install the Playwright browser used by the gallery tests
test-install:
    npm install && npx playwright install chromium

# Gallery/lightbox tests. Rebuilds the site first. Ex: just test --ui
# Ex: just test led-lightbox --project=mobile
test *args:
    npx playwright test {{args}}

# Same, against the existing _site — skips the ~15s Jekyll rebuild
test-fast *args:
    SKIP_BUILD=1 npx playwright test {{args}}
