set shell := ["bash", "-cu"]

# List available recipes
default:
    @just --list

# Install Ruby gem dependencies
install:
    bundle install

# Serve the site locally (default Jekyll port 4000, livereload enabled)
serve port="4000":
    bundle exec jekyll serve --port {{port}} --livereload

# Serve and open the yotein page in the default browser
yotein port="4000":
    @( sleep 2 && open "http://127.0.0.1:{{port}}/yotein/" ) &
    bundle exec jekyll serve --port {{port}} --livereload

# Build the site to _site/ without serving
build:
    bundle exec jekyll build

# Remove _site/ and .jekyll-cache/
clean:
    bundle exec jekyll clean
