# Vulnerable target lab: Apache HTTPd 2.4.49 — CVE-2021-41773 path traversal,
# with mod_cgid enabled so the traversed /cgi-bin/ path executes binaries
# (RCE). See README.md for the verified PoCs and acceptance checks.
#
# Personal, disposable red-team lab target for Raptix C2 session testing.
# Not referenced by the production docker-compose.yml stack, no host ports,
# capabilities dropped to the minimum httpd needs to run.
FROM httpd:2.4.49@sha256:dcba0d12e2362fb0c50ec524ae8aa1cca4a4ba7216617a57e7bbca20767e79cc

# The 2.4.49 image sits on Debian buster, long removed from deb.debian.org;
# point apt at archive.debian.org so the build stays reproducible.
RUN set -eux; \
    sed -i 's|http://deb.debian.org|http://archive.debian.org|g; s|http://security.debian.org|http://archive.debian.org|g' /etc/apt/sources.list; \
    echo 'Acquire::Check-Valid-Until "false";' > /etc/apt/apt.conf.d/99archive; \
    apt-get update; \
    apt-get install -y --no-install-recommends curl ca-certificates; \
    rm -rf /var/lib/apt/lists/*

# Move the listener off :80 so the container needs no NET_BIND_SERVICE
# capability (the Dockerfile caps are SETUID/SETGID only — see compose file).
RUN sed -i 's/^Listen 80$/Listen 8080/' /usr/local/apache2/conf/httpd.conf

# Vulnerability overlay: the traversal itself is stock 2.4.49 behaviour
# (CVE-2021-41773); this enables mod_cgid so the traversal reaches /bin/sh.
COPY conf/vuln.conf /usr/local/apache2/conf/vuln.conf
RUN printf '\nInclude conf/vuln.conf\n' >> /usr/local/apache2/conf/httpd.conf

# Verification flag: regenerated at every container start so the direct-vs-C2
# flag match in README's acceptance checks is evidence of live execution.
COPY lab-entrypoint.sh /usr/local/bin/lab-entrypoint.sh
RUN chmod 0755 /usr/local/bin/lab-entrypoint.sh

EXPOSE 8080
CMD ["lab-entrypoint.sh"]
