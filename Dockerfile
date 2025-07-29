FROM --platform=linux/amd64 jekyll/jekyll:latest

# Copy Gemfile first for better caching
COPY Gemfile* /srv/jekyll/

# Install dependencies
RUN bundle install

# Set working directory
WORKDIR /srv/jekyll

# Default command
CMD ["jekyll", "serve", "--watch", "--force_polling", "--livereload", "--incremental", "--host", "0.0.0.0"]