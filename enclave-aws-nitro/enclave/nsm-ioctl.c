/*
 * nsm-ioctl.c — NSM attestation document helper
 *
 * Reads a CBOR-encoded NSM attestation request from stdin, calls the
 * /dev/nsm ioctl, and writes the CBOR response to stdout.
 *
 * The NSM ioctl interface (AWS Nitro):
 *   fd  = open("/dev/nsm", O_RDWR)
 *   cmd = 0xC0609900  (NSM_IOCTL_CMD: _IOWR('n', 0, struct nsm_iovec))
 *
 * struct nsm_iovec {
 *     __u32  request_len;   // in
 *     __u32  response_len;  // in: buffer size, out: actual length
 *     __u8  *request;
 *     __u8  *response;
 * };
 *
 * This binary keeps the Node.js code (nsm.ts) free from native addons.
 *
 * Compile: gcc -O2 -static -o nsm-ioctl nsm-ioctl.c
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/ioctl.h>
#include <errno.h>

#define NSM_DEV_PATH    "/dev/nsm"
#define NSM_IOCTL_CMD   0xC0609900UL
#define MAX_REQUEST     4096
#define MAX_RESPONSE    16384

struct nsm_iovec {
    unsigned int  request_len;
    unsigned int  response_len;
    unsigned char *request;
    unsigned char *response;
};

static void die(const char *msg) {
    perror(msg);
    exit(1);
}

int main(void) {
    /* Read CBOR request from stdin */
    unsigned char req_buf[MAX_REQUEST];
    ssize_t req_len = 0;
    ssize_t n;
    while ((n = read(STDIN_FILENO, req_buf + req_len,
                     (size_t)(MAX_REQUEST - req_len))) > 0) {
        req_len += n;
    }
    if (req_len <= 0) {
        fprintf(stderr, "nsm-ioctl: empty request\n");
        return 1;
    }

    unsigned char resp_buf[MAX_RESPONSE];
    memset(resp_buf, 0, sizeof(resp_buf));

    struct nsm_iovec iov;
    iov.request_len  = (unsigned int)req_len;
    iov.response_len = MAX_RESPONSE;
    iov.request      = req_buf;
    iov.response     = resp_buf;

    int fd = open(NSM_DEV_PATH, O_RDWR);
    if (fd < 0) die("open(/dev/nsm)");

    if (ioctl(fd, NSM_IOCTL_CMD, &iov) < 0) die("ioctl(NSM)");
    close(fd);

    /* Write CBOR response to stdout */
    ssize_t written = 0;
    while ((size_t)written < iov.response_len) {
        n = write(STDOUT_FILENO, resp_buf + written,
                  (size_t)((int)iov.response_len - written));
        if (n <= 0) die("write(stdout)");
        written += n;
    }

    return 0;
}
