// keepawake — GNOME Shell top-bar indicator for the keepawake CLI.
//
// The extension never touches power settings itself. It reads the small state
// files the CLI keeps in $XDG_RUNTIME_DIR/keepawake and runs `keepawake ...`
// for every action, so the bar and the terminal always agree.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const PRESETS = [
    ['15m', '15m'],
    ['30m', '30m'],
    ['1h', '1h'],
    ['2h', '2h'],
    ['4h', '4h'],
    ['∞', 'forever'],
];
const EXTENDS = ['+15m', '+30m', '+1h'];
const MODES = [
    ['both', 'AC + battery'],
    ['ac', 'AC only'],
    ['battery', 'Battery only'],
];

function readKv(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        if (!ok)
            return null;
        const out = {};
        for (const line of new TextDecoder().decode(bytes).split('\n')) {
            const i = line.indexOf('=');
            if (i > 0)
                out[line.slice(0, i)] = line.slice(i + 1);
        }
        return out;
    } catch {
        return null;
    }
}

function fmtShort(s) {
    s = Math.max(0, s);
    if (s >= 3600)
        return `${Math.floor(s / 3600)}h${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}m`;
    if (s >= 60)
        return `${Math.ceil(s / 60)}m`;
    return `${s}s`;
}

function fmtLong(s) {
    s = Math.max(0, s);
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    if (h)
        return `${h}h ${String(m).padStart(2, '0')}m`;
    if (m)
        return `${m}m ${String(sec).padStart(2, '0')}s`;
    return `${sec}s`;
}

function fmtClock(epoch) {
    const d = GLib.DateTime.new_from_unix_local(epoch);
    const today = GLib.DateTime.new_now_local();
    const sameDay = d.get_day_of_year() === today.get_day_of_year() &&
        d.get_year() === today.get_year();
    return d.format(sameDay ? '%H:%M' : '%a %H:%M');
}

const KeepawakeIndicator = GObject.registerClass(
class KeepawakeIndicator extends PanelMenu.Button {
    _init(ext) {
        super._init(0.5, 'Keepawake');
        this._ext = ext;
        this._state = {running: false};
        this._tickId = 0;

        this._iconOn = Gio.FileIcon.new(
            ext.dir.resolve_relative_path('icons/keepawake-on-symbolic.svg'));
        this._iconOff = Gio.FileIcon.new(
            ext.dir.resolve_relative_path('icons/keepawake-off-symbolic.svg'));

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this._icon = new St.Icon({gicon: this._iconOff, style_class: 'system-status-icon'});
        this._label = new St.Label({
            style_class: 'keepawake-panel-label',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        box.add_child(this._icon);
        box.add_child(this._label);
        this.add_child(box);

        this._buildMenu();

        this._watchState();
        this._refresh();
    }

    // Middle click toggles without opening the menu.
    vfunc_event(event) {
        if (event.type() === Clutter.EventType.BUTTON_PRESS &&
            event.get_button() === Clutter.BUTTON_MIDDLE) {
            this._run(this._state.running ? ['stop'] : ['forever']);
            return Clutter.EVENT_STOP;
        }
        return super.vfunc_event(event);
    }

    // ── menu ──────────────────────────────────────────────────────────────

    _buildMenu() {
        this._switch = new PopupMenu.PopupSwitchMenuItem('Keep awake', false);
        this._switch.connect('toggled', (_i, on) => this._run(on ? ['forever'] : ['stop']));
        this.menu.addMenuItem(this._switch);

        this._status = new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false});
        this._status.label.add_style_class_name('keepawake-status');
        this.menu.addMenuItem(this._status);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Keep awake for'));
        this._presetButtons = this._chipRow(this.menu, PRESETS, arg => this._run([arg]));

        this._extendItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this._extendButtons = this._chips(this._extendItem,
            EXTENDS.map(e => [e, e]), arg => this._run([arg]));
        this.menu.addMenuItem(this._extendItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._modeMenu = new PopupMenu.PopupSubMenuMenuItem('Power');
        this._modeItems = {};
        for (const [mode, label] of MODES) {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => this._setMode(mode));
            this._modeMenu.menu.addMenuItem(item);
            this._modeItems[mode] = item;
        }
        this.menu.addMenuItem(this._modeMenu);
        this._pendingMode = 'both';

        // Keep the countdown in the menu live while it is open.
        this.menu.connect('open-state-changed', () => this._render());
    }

    _chipRow(menu, entries, onClick) {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const buttons = this._chips(item, entries, onClick);
        menu.addMenuItem(item);
        return buttons;
    }

    _chips(item, entries, onClick) {
        const row = new St.BoxLayout({style_class: 'keepawake-chips', x_expand: true});
        const buttons = [];
        for (const [label, arg] of entries) {
            const b = new St.Button({
                label,
                style_class: 'keepawake-chip',
                can_focus: true,
                x_expand: true,
            });
            b.connect('clicked', () => onClick(arg));
            b._arg = arg;
            row.add_child(b);
            buttons.push(b);
        }
        item.add_child(row);
        return buttons;
    }

    _setMode(mode) {
        this._pendingMode = mode;
        if (this._state.running)
            this._run(['mode', mode]);
        else
            this._render();
    }

    // ── state ─────────────────────────────────────────────────────────────

    _stateDir() {
        return GLib.build_filenamev([GLib.get_user_runtime_dir(), 'keepawake']);
    }

    _watchState() {
        const dir = Gio.File.new_for_path(this._stateDir());
        try {
            dir.make_directory_with_parents(null);
        } catch {
            // already there
        }
        this._monitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
        this._monitor.set_rate_limit(200);
        this._monitorId = this._monitor.connect('changed', () => this._refresh());
    }

    _refresh() {
        const dir = this._stateDir();
        const cfg = readKv(`${dir}/config`);
        const rt = readKv(`${dir}/runtime`);
        const pid = rt ? parseInt(rt.PID) : 0;
        const alive = pid > 0 && GLib.file_test(`/proc/${pid}`, GLib.FileTest.EXISTS);

        if (cfg && alive) {
            this._state = {
                running: true,
                protected: rt.PROTECTED === '1',
                power: rt.POWER || 'unknown',
                mode: cfg.MODE || 'both',
                deadline: parseInt(cfg.DEADLINE) || 0,
            };
            this._pendingMode = this._state.mode;
        } else if (cfg && !rt) {
            // Starting up: the service has not reported yet. Keep the old view.
            return;
        } else {
            this._state = {running: false};
        }
        this._render();
        this._syncTicker();
    }

    _syncTicker() {
        const want = this._state.running && this._state.deadline > 0;
        if (want && !this._tickId) {
            this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                this._refresh();
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!want && this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
    }

    _render() {
        const s = this._state;
        const now = Math.floor(Date.now() / 1000);
        const left = s.running && s.deadline > 0 ? s.deadline - now : null;

        // Panel
        this._icon.gicon = s.running ? this._iconOn : this._iconOff;
        this._icon.opacity = s.running && !s.protected ? 128 : 255;
        if (left !== null) {
            this._label.text = fmtShort(left);
            this._label.show();
        } else {
            this._label.hide();
        }

        // Menu
        this._switch.setToggleState(!!s.running);
        if (!s.running)
            this._status.label.text = 'Off — normal power settings';
        else if (!s.protected)
            this._status.label.text = `Standby — waiting for ${s.mode === 'ac' ? 'AC' : 'battery'} power`;
        else if (left !== null)
            this._status.label.text = `${fmtLong(left)} left · until ${fmtClock(s.deadline)}`;
        else
            this._status.label.text = 'On — until you turn it off';

        this._extendItem.visible = !!s.running;

        const mode = s.running ? s.mode : this._pendingMode;
        for (const [m, item] of Object.entries(this._modeItems))
            item.setOrnament(m === mode ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
        this._modeMenu.label.text = `Power: ${MODES.find(([m]) => m === mode)[1]}`;

        for (const b of this._presetButtons) {
            const active = s.running && b._arg === 'forever' && !s.deadline;
            if (active)
                b.add_style_pseudo_class('checked');
            else
                b.remove_style_pseudo_class('checked');
        }
    }

    // ── actions ───────────────────────────────────────────────────────────

    _binary() {
        return GLib.find_program_in_path('keepawake') ??
            GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'keepawake']);
    }

    _run(args) {
        // A fresh start takes the mode picked in the menu.
        if (!this._state.running && args[0] !== 'stop' && args[0] !== 'mode')
            args = [...args, this._pendingMode];

        let proc;
        try {
            proc = Gio.Subprocess.new([this._binary(), '--quiet', ...args],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_PIPE);
        } catch (e) {
            Main.notifyError('Keepawake', `Could not run keepawake: ${e.message}`);
            return;
        }
        proc.communicate_utf8_async(null, null, (p, res) => {
            try {
                const [, , stderr] = p.communicate_utf8_finish(res);
                if (!p.get_successful() && stderr?.trim())
                    Main.notifyError('Keepawake', stderr.trim().replace(/^✗\s*/, ''));
            } catch (e) {
                logError(e, 'keepawake');
            }
            this._refresh();
        });
    }

    destroy() {
        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
        if (this._monitor) {
            this._monitor.disconnect(this._monitorId);
            this._monitor.cancel();
            this._monitor = null;
        }
        super.destroy();
    }
});

export default class KeepawakeExtension extends Extension {
    enable() {
        this._indicator = new KeepawakeIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
