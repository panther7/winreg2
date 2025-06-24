import { describe, expect, test } from '@jest/globals';
import { Registry, Hive, RegType } from './index';
describe('winreg', () => {

    test('running on Windows', () => expect(process.platform).toBe('win32'));

    // create a uniqe registry key in HKCU to test in
    let regKey = new Registry({
        hive: Hive.HKCU,
        key: '\\Software\\winreg2_Test ' + new Date().toISOString()
    });
    test('regKey is instance of Registry', () => expect(regKey).toBeInstanceOf(Registry));

    // a key that has subkeys in it
    let softwareKey = new Registry({
        hive: Hive.HKCU,
        key: '\\Software'
    });
    let utf8ValueName = "\u0628\u0639\u0636\u0020\u0627\u0633\u0645\u0020\u0627\u0644\u0642\u064a\u0645\u0629";
    let utf8ValueData = '小鹤双拼*2*^*iuvdjhcwfg^xmlnpbksqszxkrltv```y``ovt`, ":)"';

    test('softwareKey is instance of Registry', () => expect(softwareKey).toBeInstanceOf(Registry));

    describe('Registry', () => {

        describe('keyExists()', ()=>{
            test('regKey has keyExists method', () => expect(regKey).toHaveProperty('keyExists'));
            test('regKey does not already exist', async () => await expect(regKey.keyExists()).resolves.toBeFalsy());
        }); // end - describe keyExists()

        describe('create()', () => {
            test('regKey has create method', () => expect(regKey).toHaveProperty('create'));
            test('regKey can be created', async () => await expect(regKey.create()).resolves.toBeUndefined());
            test('regKey exists after being created', async ()=> await expect(regKey.keyExists()).toBeTruthy());
        }); // end - describe create()

        describe('set()', () => {
            test('regKey has set method', () => expect(regKey).toHaveProperty('set'));
            test('can set a string value', async () => await expect(regKey.set('SomeString', RegType.REG_SZ, 'SomeValue')).resolves.toBeUndefined());
            test('can set a string value containing $', async () => await expect(regKey.set('SomeSpecialString', RegType.REG_SZ, '`$HOME```````')).resolves.toBeUndefined());
            test('can set a string value with UTF-8 characters', async () => await expect(regKey.set(utf8ValueName, RegType.REG_SZ, utf8ValueData)).resolves.toBeUndefined());
        }); // end - describe set

        describe('valueExists()', () => {
            test('regKey has valueExists method', () => expect(regKey).toHaveProperty('valueExists'));
            test('can check for existing string value', async () => await expect(regKey.valueExists('SomeString')).resolves.toBeTruthy());
            test('can check for existing string value with special & UTF-8 characters', async () => await expect(regKey.valueExists(utf8ValueName)).resolves.toBeTruthy());
        }); // end - describe valueExists

        describe('get()', () => {
            test('regKey has get method', () => expect(regKey).toHaveProperty('get'));
            test('can get a string value', async () => expect((await regKey.get('SomeString')).value).toBe('SomeValue'));
            test('can get a string value containing escaped $', async () => expect((await regKey.get('SomeSpecialString')).value).toBe('`$HOME```````'));
            test('can get a string value with UTF-8 characters', async () => expect((await regKey.get(utf8ValueName)).value).toBe(utf8ValueData));

        }); // end - describe get

        describe('values()', () => {
            test('regKey has values method', () => expect(regKey).toHaveProperty('values'));
            test('returns array of RegistryItem objects', async () => 
                await regKey.values()
                    .then(arr=> arr.forEach(item =>
                        expect(item).toHaveProperty('value')
                    ))
            );
        }); // end - describe values

        describe('remove()', function () {
            test('regKey has remove method', () => expect(regKey).toHaveProperty('remove'));
            test('can remove a string value', async () => await expect(regKey.remove('SomeString')).resolves.toBeUndefined());
            test('can remove a string value containing escaped % and ^', async () => await expect(regKey.remove('SomeSpecialString')).resolves.toBeUndefined());
            test('can remove a string value with special & UTF-8 characters', async () => await expect(regKey.remove(utf8ValueName)).resolves.toBeUndefined());
        }); // end - describe remove

        describe('keys()', function () {
            test('regKey has keys method', () => expect(regKey).toHaveProperty('keys'));
            test('returns array of Registry objects', () =>
                softwareKey.keys().then(keys =>
                    keys.forEach(key=>expect(key).toBeInstanceOf(Registry))
                )
            );
        }); // end - describe keys()

        describe('clear()', () => {
            test('regKey has clear method', () => expect(regKey).toHaveProperty('clear'));
        }); // end - describe clear

        describe('destroy()', function () {
            test('regKey has destroy method', () => expect(regKey).toHaveProperty('destroy'));

            test('regKey can be destroyed', async () => expect(regKey.destroy()).resolves.toBeUndefined() );

            test('regKey is missing after being destroyed', async () => await expect(regKey.keyExists()).resolves.toBeFalsy());

        }); // end - describe destroy()

    }); // end - describe Registry

}); // end - describe winreg