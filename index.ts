// modified based off fresc81/node-winreg


/************************************************************************************************************
 * winreg2 - rewrite of the original `node-winreg` by FrEsC (Paul Bottin) for async-await compatability
 * @author YesWeDont
 *
 */

import { format } from 'node:util';
import { join } from 'node:path';
import { exec } from 'node:child_process';

/** The registry hive IDs */
export const enum Hive {
    HKLM = 'HKEY_LOCAL_MACHINE',
    HKCU = 'HKEY_CURRENT_USER',
    HKCR = 'HKEY_CLASSES_ROOT',
    HKU = 'HKEY_USERS',
    HKCC = 'HKEY_CURRENT_CONFIG'
}

/** The registry hive architecture ('x86' or 'x64'; only valid on Windows 64 Bit Operating Systems) */
export const enum Arch {
    x86 = 'x86',
    x64 = 'x64'
}

/** Registry value type IDs */
export const enum RegType {
    REG_SZ = 'REG_SZ',
    REG_MULTI_SZ = 'REG_MULTI_SZ',
    REG_EXPAND_SZ = 'REG_EXPAND_SZ',
    REG_DWORD = 'REG_DWORD',
    REG_QWORD = 'REG_QWORD',
    REG_BINARY = 'REG_BINARY',
    REG_NONE = 'REG_NONE',
}

const
    HIVES = [Hive.HKLM, Hive.HKCU, Hive.HKCR, Hive.HKU, Hive.HKCC],

    REG_TYPES = [RegType.REG_SZ, RegType.REG_MULTI_SZ, RegType.REG_EXPAND_SZ, RegType.REG_DWORD, RegType.REG_QWORD, RegType.REG_BINARY, RegType.REG_NONE],

    /* General key pattern */
    KEY_PATTERN = /(\\[a-zA-Z0-9_\s]+)*/,

    /* Key path pattern (as returned by REG-cli) */
    PATH_PATTERN = /^(HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER|HKEY_CLASSES_ROOT|HKEY_USERS|HKEY_CURRENT_CONFIG)(.*)$/,

    /* Registry item pattern */
    ITEM_PATTERN = /^(.*)\s(REG_SZ|REG_MULTI_SZ|REG_EXPAND_SZ|REG_DWORD|REG_QWORD|REG_BINARY|REG_NONE)\s+([^\s].*)$/;

/** Escape backticks */
function quoteAround(str: string) {
    return `"${str.replace(/`/g, "``").replace(/\$/g, "`$").replace(/[\u0000-\u001F\u007F-\u009F]/g,"")}"`
}

class ProcessUncleanExitError extends Error {

    /**
     * Creates an Error object that contains the exit code of the REG.EXE process.
     * This contructor is private. Objects of this type are created internally and used as parameters for <code>reject</code> in case the REG.EXE process doesn't exit cleanly.
    */
    constructor(/** The error message.*/ readonly message:string, /** The process exit code. */readonly code:number) {

        super(message);

        /** The error name. @readonly @type {string} */
        this.name = ProcessUncleanExitError.name;

    }
}


/* Returns an error message containing the stdout/stderr of the child process */
function mkErrorMsg(registryCommand:string, code:number, output:{stdout: string, stderr: string}) {
    let stdout = output['stdout'].trim();
    let stderr = output['stderr'].trim();

    let msg = format('%s command exited with code %d:\n%s\n%s', registryCommand, code, stdout, stderr);
    return new ProcessUncleanExitError(msg, code);
}


class RegistryItem {
    /**
     * Creates a single registry value record.
     * This contructor is private. Objects of this type are created internally and returned by methods of {@link Registry} objects.
    */

    constructor(
        /** the hostname (can leave blank) */ readonly host: string, /** hive id */ readonly hive:string,
        /** the registry key */ readonly key:string, /** the value name */readonly name:string,
        /** the value type */ readonly type: RegType, /** the value */readonly value:string,
        /** the hive archetecture */ readonly arch: Arch|undefined
    ) {}
}

interface RegistryOptions {
    /** the hostname */ host?: string,
    /** the hive ID, defaults to Hive.HKLM */ hive?: Hive,
    /** the registry key */ key: string,
    /** the optional registry hive architecture ('x86' or 'x64'; only valid on Windows 64 Bit Operating Systems) */arch?: Arch
}
export class Registry {
    /** Creates a registry object, which provides access to a single registry key.
     *
     * @public
     * 
     * @param {RegistryOptions} options - the options
     *
     * @example
     * import { Registry } from 'winreg2';
     * autoStartCurrentUser = new Registry({
     *       hive: Registry.HKCU,
     *       key:  '\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
     *     });
     *
     */
    constructor(options:RegistryOptions) {

        this.host = options.host || '';

        this.hive = options.hive || Hive.HKLM;

        this.key = options.key || '';

        this.path = quoteAround((this.host.length == 0 ? '' : '\\\\' + this.host + '\\') + this.hive + this.key);

        this.arch = options.arch;

        // validate options...
        if (HIVES.indexOf(this.hive) == -1)
            throw new Error('illegal hive specified.');

        if (!KEY_PATTERN.test(this.key))
            throw new Error('illegal key specified.');

        if (this.arch && this.arch != 'x64' && this.arch != 'x86')
            throw new Error('illegal architecture specified (use x86 or x64)');

    }

    /** The hostname. */
    readonly host:string;
    /** The hive ID. */
    readonly hive: Hive;
    /** The registry key name. */
    readonly key: string;
    /** The full path to the registry key. */
    readonly path:string;
    /** The registry hive architecture ('x86' or 'x64'). */
    readonly arch: Arch|undefined;

    /** A {@link Registry} instance that points to the parent registry key. */
    get parent() {
        let i = (this.key || '').lastIndexOf('\\');
        return new Registry({
            host: this.host,
            hive: this.hive,
            key: (i == -1) ? '' : (this.key || '').substring(0, i),
            arch: this.arch || undefined
        });
    }

    /** The name of the default value. May be used instead of the empty string literal for better readability. */
    static DEFAULT_VALUE = '';

    /** Path of REG.exe used. */
    static REG_PATH = join(process.env.windir || '', 'system32', 'reg.exe');

    /** Private utility function to execute a command and return output. */
    private async runCommand(args: string[]): Promise<string>{
        if (this.arch) {
            let arch;
            if (this.arch == 'x64') arch = '64';
            else if (this.arch == 'x86') arch = '32';
            else throw new Error('illegal architecture: ' + this.arch + ' (use x86 or x64)');

            args.push('/reg:' + arch);
        }

        // although this is slightly safer, this does not work for some reason
        // let child = spawn(Registry.REG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] }),
        //     stdout = '',
        //     stderr = '',
        //     addStdout = data=>stdout+=data.toString(),
        //     addStderr = data=>stderr+=data.toString();
        // child.stdout.on('data', addStdout);
        // child.stderr.on('data', addStderr);
        // return await new Promise((res, rej)=>{
        //     child.once('close', code=>{
        //         child.stdout.off('data', addStdout);
        //         child.stderr.off('data', addStderr);
        //         if(code !== 0) rej(mkErrorMsg(args[0], code, { stdout, stderr }));
        //         else res(stdout);
        //     });
        // });
        return await new Promise((res, rej) => {
            let regCommand = 'chcp 65001; ' + [Registry.REG_PATH, ...args].join(' ');
            // console.log(`Will run ${regCommand}`);
            let child = exec(regCommand, {shell:"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"}, (err, stdout, stderr) => {
                if (err) {
                    rej(mkErrorMsg(args[0], child.exitCode || 0, { stdout, stderr }));
                }
                else res(stdout);
            });
        });
    }


    /** Retrieve all values from this registry key. */
    async values(): Promise<RegistryItem[]>{

        let output = await this.runCommand(['QUERY', this.path]),
            result: RegistryItem[] = [];

        output.split('\n')
            .map(line => line.trim())
            .filter(line => line) // blank lines
            .forEach(line => { // construct the RegistryItem containers
                let match = ITEM_PATTERN.exec(line), name, type, value;
                if (match) {
                    name = match[1].trim();
                    type = match[2].trim();
                    value = match[3];
                    result.push(new RegistryItem(this.host, this.hive, this.key, name, type as RegType, value, this.arch));
                }
            });
        return result;
    }

    /** Retrieve all subkeys from this registry key. */
    async keys(): Promise<Registry[]>{

        let output = await this.runCommand(['QUERY', this.path, '/k', '/f', '*']),
            result: Registry[] = [];

        output.split('\n')
            .map(line => line.trim())
            .filter(line => line)
            .map(line => {
                let match = PATH_PATTERN.exec(line);

                if (match) {
                    let key = match[2];
                    if (key && (key !== this.key)) { // exclude the key itself
                        result.push(new Registry({
                            host: this.host,
                            hive: (match[1] as Hive), key,
                            arch: this.arch || undefined
                        }));
                    }
                }
            });

        return result;
    }

    /** Gets a named value from this registry key.
    * @param {string} name - the value name, use {@link Registry.DEFAULT_VALUE} or an empty string for the default value
    */
    async get(name: string){

        let args = ['QUERY', this.path];
        if (name == '')
            args.push('/ve');
        else
            args = args.concat(['/v', quoteAround(name)]);

        let output = await this.runCommand(args),
            items = output
                .split('\n')
                .map(line => line.trim())
                .filter(line => line);

        //Get last item - so it works in XP where REG QUERY returns with a header
        let item = items[items.length - 1] || '',
            match = ITEM_PATTERN.exec(item);

        if (match) {
            let name = match[1].trim(),
                type = match[2].trim(),
                value = match[3];
            return new RegistryItem(this.host, this.hive, this.key, name, (type as RegType), value, this.arch);
        } else throw new Error('Key not found');
    }

    /**
     * Sets a named value in this registry key, overwriting an already existing value.
     * @param {string} name - the value name, use {@link Registry.DEFAULT_VALUE} or an empty string for the default value
     * @param {RegType} type - the value type
     * @param {string} value - the value
    */
    async set(name:string, type:RegType, value:string){

        if (REG_TYPES.indexOf(type) == -1) throw Error('illegal type specified.');

        let args = ['ADD', this.path];
        if (name == '') args.push('/ve');
        else args = args.concat(['/v', quoteAround(name)]);

        args = args.concat(['/t', type, '/d', quoteAround(value), '/f']);

        await this.runCommand(args);
    }

    /**
     * Remove a named value from this registry key. If name is empty, sets the default value of this key.
     * Note: This key must be already existing.
     * @param {string} name - the value name, use {@link Registry.DEFAULT_VALUE} or an empty string for the default value.
     */
    async remove(name: string){ await this.runCommand(name ? ['DELETE', this.path, '/f', '/v', quoteAround(name)] : ['DELETE', this.path, '/f', '/ve']); }

    /** Remove all subkeys and values (including the default value) from this registry key. */
    async clear(){ await this.runCommand(['DELETE', this.path, '/f', '/va']); }

    /** Alias for the clear method to keep it backward compatible.
     * @method
     * @deprecated Use {@link Registry#clear} or {@link Registry#destroy} in favour of this method.
    */
    async erase() { return this.clear(); }

    /** Delete this key and all subkeys from the registry. */
    async destroy() { await this.runCommand(['DELETE', this.path, '/f']); }

    /** Create this registry key. Note that this is a no-op if the key already exists. */
    async create() { await this.runCommand(['ADD', this.path, '/f']); }


    /** Checks if this key already exists. */
    keyExists() {
        return this.values().then(() => true, err => {
            if (err.code == 1) return false;
            else throw err;
        });
    }

    /**
     * Checks if a value with the given name already exists within this key.
     * @param {string} name - the value name, use {@link Registry.DEFAULT_VALUE} or an empty string for the default value
     */
    valueExists(name:string) {
        return this.get(name).then(() => true, err => {
            if (err.code == 1) return false;
            else throw err;
        });
    }
}