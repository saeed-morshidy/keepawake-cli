.PHONY: install uninstall test ui-test lint zip

install:
	./install.sh

uninstall:
	./install.sh --uninstall

test:
	bash tests/run.sh

# Drives the top-bar extension in a headless GNOME Shell (needs a GNOME desktop).
ui-test:
	tests/ui/run.sh

lint:
	shellcheck -x bin/keepawake install.sh tests/run.sh tests/ui/run.sh

# Package the extension for extensions.gnome.org
zip:
	cd gnome-extension/keepawake@saeed-morshidy.github.io && \
	zip -r ../../keepawake@saeed-morshidy.github.io.shell-extension.zip . -x '*.zip'
