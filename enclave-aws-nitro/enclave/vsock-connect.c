/*
 * vsock-connect.c — minimal vsock stdio bridge
 *
 * Usage: vsock-connect <CID> <PORT>
 *
 * Opens an AF_VSOCK stream socket, connects to the given CID:port, then
 * bridges stdin → socket and socket → stdout until EOF on either end.
 *
 * Used by kms.ts (inside the Nitro enclave) to talk to the parent-side KMS
 * proxy without requiring a native Node.js addon.
 *
 * Compile: gcc -O2 -static -o vsock-connect vsock-connect.c
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <sys/socket.h>
#include <linux/vm_sockets.h>   /* AF_VSOCK, struct sockaddr_vm */
#include <poll.h>

#define BUF_SIZE 65536

static void die(const char *msg) {
    perror(msg);
    exit(1);
}

int main(int argc, char *argv[]) {
    if (argc != 3) {
        fprintf(stderr, "usage: vsock-connect <cid> <port>\n");
        return 1;
    }

    unsigned int cid  = (unsigned int)atoi(argv[1]);
    unsigned int port = (unsigned int)atoi(argv[2]);

    int sock = socket(AF_VSOCK, SOCK_STREAM, 0);
    if (sock < 0) die("socket(AF_VSOCK)");

    struct sockaddr_vm addr;
    memset(&addr, 0, sizeof(addr));
    addr.svm_family = AF_VSOCK;
    addr.svm_cid    = cid;
    addr.svm_port   = port;

    if (connect(sock, (struct sockaddr *)&addr, sizeof(addr)) < 0)
        die("connect(vsock)");

    /* Bridge: poll stdin + sock, copy in both directions */
    char buf[BUF_SIZE];
    struct pollfd fds[2];
    fds[0].fd = STDIN_FILENO;  fds[0].events = POLLIN;
    fds[1].fd = sock;          fds[1].events = POLLIN;

    while (1) {
        int r = poll(fds, 2, -1);
        if (r < 0) die("poll");

        /* stdin → socket */
        if (fds[0].revents & POLLIN) {
            ssize_t n = read(STDIN_FILENO, buf, BUF_SIZE);
            if (n <= 0) { shutdown(sock, SHUT_WR); fds[0].fd = -1; }
            else {
                ssize_t written = 0;
                while (written < n) {
                    ssize_t w = write(sock, buf + written, (size_t)(n - written));
                    if (w <= 0) die("write(sock)");
                    written += w;
                }
            }
        }

        /* socket → stdout */
        if (fds[1].revents & (POLLIN | POLLHUP)) {
            ssize_t n = read(sock, buf, BUF_SIZE);
            if (n <= 0) break; /* server closed connection */
            ssize_t written = 0;
            while (written < n) {
                ssize_t w = write(STDOUT_FILENO, buf + written, (size_t)(n - written));
                if (w <= 0) die("write(stdout)");
                written += w;
            }
        }
    }

    close(sock);
    return 0;
}
