FROM php:8.4-apache

COPY docker-php.ini /usr/local/etc/php/conf.d/zz-akademi.ini

RUN apt-get update && apt-get install -y --no-install-recommends \
    libcurl4-openssl-dev \
    libonig-dev \
    libzip-dev \
    unzip \
    && docker-php-ext-install -j"$(nproc)" \
        curl \
        mbstring \
        pdo_mysql \
        zip \
    && a2enmod rewrite headers \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

RUN sed -i 's/DirectoryIndex index.html index.cgi index.pl index.php index.xhtml index.htm/DirectoryIndex index.php index.html/' /etc/apache2/mods-enabled/dir.conf

RUN printf '%s\n' \
    '<Directory /var/www/html>' \
    '    Options -Indexes' \
    '    AllowOverride All' \
    '    Require all granted' \
    '</Directory>' \
    > /etc/apache2/conf-available/akademi.conf \
    && a2enconf akademi

RUN mkdir -p /var/lib/akademi-storage && chown www-data:www-data /var/lib/akademi-storage && chmod 700 /var/lib/akademi-storage
EXPOSE 80
