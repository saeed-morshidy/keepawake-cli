// keepawake — GNOME Shell top-bar indicator for the keepawake CLI.
//
// The extension never touches power settings itself. It reads the small state
// files the CLI keeps in $XDG_RUNTIME_DIR/keepawake and runs `keepawake ...`
// for every action, so the bar and the terminal always agree.
//
// Rule that keeps it honest: the UI only *shows* state. Nothing that renders
// state may trigger an action — actions come from clicks only.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const PRESETS = ['15m', '30m', '1h', '2h', '4h'];
const EXTENDS = ['+15m', '+30m', '+1h'];
const MODES = [
    ['both', 'Any power'],
    ['ac', 'AC'],
    ['battery', 'Battery'],
];
const DIM = 170; // opacity for secondary text; works on light and dark themes
const NO_ORNAMENT = PopupMenu.Ornament.HIDDEN ?? PopupMenu.Ornament.NONE;

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

// 5025 -> "1:23:45", 754 -> "12:34"
function fmtTimer(s) {
    s = Math.max(0, s);
    const h = Math.floor(s / 3600);
    const m = Math.floor(s % 3600 / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function fmtClock(epoch) {
    const d = GLib.DateTime.new_from_unix_local(epoch);
    const now = GLib.DateTime.new_now_local();
    const sameDay = d.get_day_of_year() === now.get_day_of_year() &&
        d.get_year() === now.get_year();
    return d.format(sameDay ? '%H:%M' : '%a %H:%M');
}

function vbox(params = {}) {
    const box = new St.BoxLayout(params);
    if ('orientation' in box)
        box.orientation = Clutter.Orientation.VERTICAL;
    else
        box.vertical = true;
    return box;
}

function plainItem(styleClass) {
    const item = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
        style_class: styleClass,
    });
    item.setOrnament(NO_ORNAMENT);
    return item;
}

// Header: icon, title + one-line status, and an on/off switch. The whole row
// is the toggle; the switch only mirrors the state.
const HeaderItem = GObject.registerClass(
class KeepawakeHeaderItem extends PopupMenu.PopupBaseMenuItem {
    _init(onToggle) {
        super._init({style_class: 'keepawake-header'});
        this.setOrnament(NO_ORNAMENT);
        this._onToggle = onToggle;

        this.icon = new St.Icon({style_class: 'keepawake-header-icon', y_align: Clutter.ActorAlign.CENTER});
        this.add_child(this.icon);

        const text = vbox({x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this.title = new St.Label({text: 'Keep awake', style_class: 'keepawake-title'});
        this.subtitle = new St.Label({style_class: 'keepawake-subtitle'});
        this.subtitle.opacity = DIM;
        text.add_child(this.title);
        text.add_child(this.subtitle);
        this.add_child(text);
        this.label_actor = this.title;

        this.switch = new PopupMenu.Switch(false);
        this.switch.reactive = false; // clicks go to the row
        this.switch.y_align = Clutter.ActorAlign.CENTER;
        this.add_child(this.switch);
    }

    activate(_event) {
        // Don't call super: the menu stays open so the result is visible.
        this._onToggle(!this.switch.state);
    }
});

const KeepawakeIndicator = GObject.registerClass(
class KeepawakeIndicator extends PanelMenu.Button {
    _init(ext) {
        super._init(0.5, 'Keepawake');
        this._state = {running: false};
        this._mode = 'both';  // used for the next start
        this._busy = false;
        this._tickId = 0;

        const icon = name => Gio.FileIcon.new(ext.dir.resolve_relative_path(`icons/${name}.svg`));
        this._iconOn = icon('keepawake-on-symbolic');
        this._iconOff = icon('keepawake-off-symbolic');

        // Panel: cup + time left
        const box = new St.BoxLayout({style_class: 'panel-status-menu-box keepawake-panel'});
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

    // ── menu ──────────────────────────────────────────────────────────────

    _buildMenu() {
        this.menu.box.add_style_class_name('keepawake-menu');

        this._header = new HeaderItem(on => this._run(on ? ['forever'] : ['stop']));
        this.menu.addMenuItem(this._header);

        // Countdown, only while running
        this._timerItem = plainItem('keepawake-timer');
        const tbox = vbox({x_expand: true});
        this._countdown = new St.Label({style_class: 'keepawake-countdown', x_align: Clutter.ActorAlign.CENTER});
        this._until = new St.Label({style_class: 'keepawake-until', x_align: Clutter.ActorAlign.CENTER});
        this._until.opacity = DIM;
        tbox.add_child(this._countdown);
        tbox.add_child(this._until);
        this._timerItem.add_child(tbox);
        this.menu.addMenuItem(this._timerItem);

        this._extend = this._buttonRow(EXTENDS.map(e => [e, e]), arg => this._run([arg]));
        this.menu.addMenuItem(this._extend.item);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._timerTitle = this._section('Keep awake for');
        this._presets = this._buttonRow(PRESETS.map(p => [p, p]), arg => this._run([arg]));
        this.menu.addMenuItem(this._presets.item);

        this._section('Power');
        this._modes = this._buttonRow(MODES, mode => this._setMode(mode));
        this.menu.addMenuItem(this._modes.item);

        this.menu.connect('open-state-changed', (_m, open) => {
            if (open)
                this._refresh();
        });
    }

    _section(text) {
        const item = plainItem('keepawake-section');
        const label = new St.Label({text, style_class: 'keepawake-section-label'});
        label.opacity = DIM;
        item.add_child(label);
        this.menu.addMenuItem(item);
        return label;
    }

    _buttonRow(entries, onClick) {
        const item = plainItem('keepawake-row');
        const row = new St.BoxLayout({style_class: 'keepawake-buttons', x_expand: true});
        row.layout_manager.homogeneous = true; // equal-width buttons
        const buttons = new Map();
        for (const [arg, label] of entries) {
            const b = new St.Button({
                label,
                style_class: 'keepawake-button',
                can_focus: true,
                x_expand: true,
            });
            b.connect('clicked', () => onClick(arg));
            row.add_child(b);
            buttons.set(arg, b);
        }
        item.add_child(row);
        return {item, buttons};
    }

    _setMode(mode) {
        this._mode = mode;
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
            this._mode = this._state.mode;
        } else if (cfg && !rt) {
            return; // starting: the service hasn't reported yet
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
        const timed = s.running && s.deadline > 0;
        const left = timed ? s.deadline - now : 0;
        const standby = s.running && !s.protected;
        const waitingFor = s.mode === 'ac' ? 'AC' : 'battery';

        // Panel
        this._icon.gicon = s.running ? this._iconOn : this._iconOff;
        this._icon.opacity = standby ? 128 : 255;
        this._label.visible = s.running;
        this._label.text = timed ? fmtTimer(left) : '∞';
        if (timed)
            this._label.remove_style_class_name('keepawake-infinite');
        else
            this._label.add_style_class_name('keepawake-infinite');
        this._label.opacity = standby ? 128 : 255;

        // Header
        const h = this._header;
        h.icon.gicon = s.running ? this._iconOn : this._iconOff;
        h.switch.state = !!s.running;
        if (!s.running)
            h.subtitle.text = 'Off';
        else if (standby)
            h.subtitle.text = `Standby — waiting for ${waitingFor} power`;
        else
            h.subtitle.text = `On · ${s.power === 'battery' ? 'on battery' : 'plugged in'}`;

        // Countdown
        this._timerItem.visible = !!s.running;
        this._countdown.text = timed ? fmtTimer(left) : 'No limit';
        this._until.text = timed ? `left · ends at ${fmtClock(s.deadline)}` : 'until you turn it off';
        this._extend.item.visible = timed;

        this._timerTitle.text = s.running ? 'Change timer' : 'Keep awake for';

        const mode = s.running ? s.mode : this._mode;
        for (const [m, b] of this._modes.buttons) {
            if (m === mode)
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
        if (this._busy)
            return;
        // A fresh start uses the power mode picked in the menu.
        if (!this._state.running && args[0] !== 'stop' && args[0] !== 'mode')
            args = [...args, this._mode];

        let proc;
        try {
            proc = Gio.Subprocess.new([this._binary(), '--quiet', ...args],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_PIPE);
        } catch (e) {
            Main.notifyError('Keepawake', `Could not run keepawake: ${e.message}`);
            return;
        }
        this._busy = true;
        proc.communicate_utf8_async(null, null, (p, res) => {
            this._busy = false;
            try {
                const [, , stderr] = p.communicate_utf8_finish(res);
                if (!p.get_successful())
                    Main.notifyError('Keepawake', stderr?.trim().replace(/^✗\s*/, '') || 'keepawake failed');
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
