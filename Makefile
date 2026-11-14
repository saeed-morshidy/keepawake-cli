.PHONY: install uninstall test lint zip

install:
	./install.sh

uninstall:
	./install.sh --uninstall

test:
	bash tests/run.sh

lint:
	shellcheck -x bin/keepawake install.sh tests/run.sh

# Package the extension for extensions.gnome.org
zip:
	cd gnome-extension/keepawake@saeed-morshidy.github.io && \
	zip -r ../../keepawake@saeed-morshidy.github.io.shell-extension.zip . -x '*.zip'
