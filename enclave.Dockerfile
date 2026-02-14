FROM node:22-alpine
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
RUN corepack enable && pnpm install && pnpm exec tsc && pnpm prune --prod && rm -rf src tsconfig.json
USER root
RUN mkdir -p /opt/evervault
ADD https://enclave-build-assets.evervault.com/installer/173cb7030ebc30708c6c98266d15dba12f0265d3e7da3f66bb7cc5c3c4dbf94f.tar.gz /opt/evervault/runtime-dependencies.tar.gz
RUN cd /opt/evervault ; tar -xzf runtime-dependencies.tar.gz ; sh ./installer.sh ; rm runtime-dependencies.tar.gz
RUN echo {\"api_key_auth\":true,\"forward_proxy_protocol\":false,\"healthcheck\":\"/health\",\"healthcheck_port\":7000,\"healthcheck_use_tls\":false,\"trusted_headers\":[],\"trx_logging_enabled\":true} > /etc/dataplane-config.json
RUN mkdir -p /etc/service/user-entrypoint
RUN printf "#!/bin/sh\nsleep 5\necho \"Checking status of data-plane\"\nSVDIR=/etc/service sv check data-plane || exit 1\necho \"Data-plane up and running\"\nwhile ! grep -q \"EV_INITIALIZED\" /etc/customer-env\n do echo \"Env not ready, sleeping user process for one second\"\n sleep 1\n done \n . /etc/customer-env\n\necho \"Booting user service...\"\ncd %s\nexec node dist/index.js\n" "$PWD"  > /etc/service/user-entrypoint/run && chmod +x /etc/service/user-entrypoint/run
ADD https://enclave-build-assets.evervault.com/runtime/1.3.4/data-plane/egress-disabled/tls-termination-enabled /opt/evervault/data-plane
RUN chmod +x /opt/evervault/data-plane
RUN mkdir -p /etc/service/data-plane
RUN printf "#!/bin/sh\necho \"Booting Evervault data plane...\"\nexec /opt/evervault/data-plane 7000\n" > /etc/service/data-plane/run && chmod +x /etc/service/data-plane/run
RUN printf "#!/bin/sh\nifconfig lo 127.0.0.1\n echo \"enclave.local\" > /etc/hostname \n echo \"127.0.0.1 enclave.local\" >> /etc/hosts \n hostname -F /etc/hostname \necho \"Booting enclave...\"\nexec runsvdir /etc/service\n" > /bootstrap && chmod +x /bootstrap
ENTRYPOINT ["/bootstrap", "1>&2"]
