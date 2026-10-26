# AETHRYON iOS Shortcut, generated from code with the Cherri compiler (see README.md).
.PHONY: help build sign verify compiler clean

help:
	@echo "make build     pinned compiler, stage tests A to D, static validation (nothing is sent anywhere)"
	@echo "make sign      sign through HubSign (third-party service) + checks -> dist/"
	@echo "make verify    re-check dist/AETHRYON.shortcut (Apple chain, content, validation, checksum)"
	@echo "make compiler  (re)build the pinned Cherri compiler"
	@echo "make clean     remove build/"

build:
	tools/build.sh

sign:
	tools/sign.sh AETHRYON

# Checks the signed file itself (Apple chain, integrity, validation, checksum).
verify:
	.venv/bin/python tools/inspect_signed.py dist/AETHRYON.shortcut
	.venv/bin/python tools/validate.py dist/AETHRYON.shortcut
	cd dist && sha256sum -c AETHRYON.shortcut.sha256

compiler:
	tools/build-cherri.sh

clean:
	rm -rf build
