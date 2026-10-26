# ytc2/ytapi — copie de développement de ytapi. AUCUNE cible n'agit sur la production.
# (Le Makefile de production est conservé en référence : Makefile.production.ref.)
.PHONY: help test test-flag-on preprod-image

help:
	@echo "make test           suite pytest complète dans un conteneur jetable sans réseau (image ytc2-ytapi:test)"
	@echo "make preprod-image  image de préproduction ytc2-ytapi:preprod (faux worker, aucune requête réseau)"

test:
	docker build --target test -t ytc2-ytapi:test .
	docker run --rm --network none ytc2-ytapi:test

preprod-image:
	docker build --target preprod -t ytc2-ytapi:preprod .
