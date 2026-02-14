FROM amazonlinux:2


# install Nitro CLI
RUN amazon-linux-extras install aws-nitro-enclaves-cli -y; \
yum install aws-nitro-enclaves-cli-devel -y;

ENTRYPOINT ["nitro-cli"]

COPY ./ev_sign /sign
