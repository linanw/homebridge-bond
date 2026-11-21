# Bond for Homebridge with Matter

This fork of aarons22/homebridge-bond 3.3.0 keeps the Bond platform identifier and existing HomeKit accessories. The Matter edition targets Homebridge 2.4.0. Install the tagged fork and enable Matter on the Bond child bridge. Pair that bridge using its own Matter QR code in Homebridge UI.

Matter endpoints use the Bond bridge and device IDs for identity. Ceiling fans with absolute speed control expose Fan Control. Independently controllable upper and lower lights get separate endpoints. Generic devices with TurnOn and TurnOff expose an on/off outlet. Shades with Open, Close and Stop expose window covering commands. Percentage positioning requires SetPosition. Bond-reported state and BPUP updates supply the state shown to controllers. RF equipment without physical feedback reports the state tracked by Bond. Devices with only toggle actions keep their original HomeKit controls.

## Upstream documentation

[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![npm](https://badgen.net/npm/v/homebridge-bond)](https://www.npmjs.com/package/homebridge-bond)
[![npm](https://badgen.net/npm/dt/homebridge-bond)](https://www.npmjs.com/package/homebridge-bond)

# homebridge-bond

Bond plug-in for [Homebridge](https://github.com/nfarina/homebridge) using the [Bond V2 API](http://docs-local.appbond.com).

## Features

This plugin currently supports the following devices and features:

- Multiple Bonds
- Supported Devices
  - Ceiling Fan
    - Light on/off
    - Up/Down light
    - Fan Speeds 1-8 (dynamic based on bond configuration)
    - Light Dimming
  - Blinds
    - Open / Close
  - Generic Device
    - On / Off (appears as switch in HomeKit)
  - Fireplace
    - Flame On / Off (appears as switch in HomeKit)


You can view the backlog of features [here](https://github.com/aarons22/homebridge-bond/). Feel free to add a feature request in the Issues tab!

## Installation

### Bond Parameters

| Option             | Required | Explanation |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ip_address`   | true   | To get your Bond IP Address, follow the instructions [here](https://github.com/aarons22/homebridge-bond/wiki/Get-Bond-IP-Address). |
| `token` | true   | This can be found in the Bond app in your Bond Settings. Scroll down until you see `Local Token`. You can tap on the row to copy to your clipboard. |
| `hide_device_ids` | false  | Array of device ids to ignore (i.e. `["1111", "2222"]`) |
| `ms_between_actions` | false | Space out actions sent to the Bond by at least this many milliseconds. |

### Easiest Configuration

For the best experience setting up this plugin, please use [homebridge-config-ui-x](https://www.npmjs.com/package/homebridge-config-ui-x).

### HOOBS Configuration

In HOOBS, you need to provide the bonds (optionally, turn on opt-in features):
```json
[
    {
        "ip_address": "<IP_ADDRESS>",
        "token": "<TOKEN>",
        "hide_device_ids": ["123456"]
    }
]
```

<ins>Example Config in HOOBS:</ins>

![Config](./images/hoobs_configuration.png)

### Basic Configuration

Assuming a global installation of `homebridge`, install the plugin:

`npm i -g homebridge-bond`

Add the `Bond` platform in your homebridge `config.json` file:

```json
"platforms": [
    {
        "platform": "Bond",
        "bonds": [
            {
                "ip_address": "<IP_ADDRESS>",
                "token": "<TOKEN>"
            }
        ],
    }
],
```

NOTE: If you have a "Smart by BOND" fan/device, you will need to add a Bond in the config for _each_ fan/device.

### Optional Platform Parameters

| Option             | Default | Explanation                                                                                                                                                         |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `include_dimmer`   | false   | If dimming is a valid action on a device, it will be included as additional switch on the accessory. When using this feature, turn the switch on to start dimming. When you reach the brightness level you would like, turn the switch off. |
| `fan_speed_values` | false   | Use fan speed values instead of percentages (i.e. Hey Siri set the Office Fan to 2) |
| `include_toggle_state` | false  | This will add a switch to single-action accessories to toggle the state (i.e. Shades, Fireplace, Generic, Lights). Fan speeds are not eligible for this option. |

## Development

I'm more than happy to take PRs if you want to fix a bug you are having or take a shot at adding a new feature you're interested in. To compile the code in realtime, run:

```
npm run dev
```

To use the local version of the plugin in homebridge, I run `npm link` in the directory of the cloned repo.

## Support

If you have general questions about usage, please use the [Discussions](https://github.com/aarons22/homebridge-bond/discussions) tab! If you are unsure if a problem you are having is actually a bug/issue with the plugin, that is a great place to start 😄.

## MatterDesk name and room synchronization

Install the public scoped package `@linanw/homebridge-bond` on Homebridge 2.4 with Matter enabled on the Bond child bridge. The upstream baseline is aarons22/homebridge-bond 3.3.0. Keep the existing `Bond` platform configuration, child bridge username, cached accessory UUIDs and Matter fabric. For an existing unscoped install, stop the bridge, back up the old package, configuration, accessory caches and Matter storage, and replace the old installation with the scoped package. Migrate the `plugin` owner from `homebridge-bond` to `@linanw/homebridge-bond` in the Bond child's HAP and Matter accessory caches. Restart and compare the published endpoint IDs and serial numbers against the backup. To roll back, stop the bridge and restore the old installation, package manifest and matching caches together.

Open a Bond accessory in MatterDesk and choose **同步名称和房间**. A fan with multiple controls exposes one editor on its primary endpoint because the controls share one Bond device. A rename or move PATCHes only the requested fields, then reads them from the bridge. Bond stores the location as a string. The room picker starts with the locations observed on that Bond bridge at discovery. A configured Apple binding restricts the picker to explicitly associated rooms. MatterDesk reports each destination independently. A missing Apple binding produces an Apple delivery failure while Bond can still confirm its own result. [Bond Local API](https://docs-local.appbond.com/)

### Apple Home on iPhone

1. Build `companion/BondHome.xcodeproj` in Xcode with a development team that can sign the HomeKit entitlement. Install on an iPhone with access to the intended Apple home. Allow Home access when iOS prompts.
2. Homebridge creates one exchange folder per Bond physical identity at `<Homebridge storage>/bond-homekit/<identity>`. Grant the intended NAS user read/write access to that device folder. Keep the private `bond-metadata` journal under Homebridge ownership. Limit SMB access to trusted accounts because the exchange carries room assignments and verified results.
3. In the iPhone Files app connect to the NAS. In **Bond 家庭同步**, select the specific exchange folder. Choose the Apple home and the corresponding accessory, pair the desired Bond locations to existing Apple rooms, then confirm the binding. Identically named accessories can be distinguished by their room and identifier suffix.
4. Keep the app open with access to that folder during the edit. Apple confirmation includes the home and accessory identifiers, actual accessory name and actual room UUID read from HomeKit. The plugin waits up to five minutes for delivery. On timeout reopen the companion and verify the current values before making a fresh edit. The app does not run as an always-on iOS background service.

A successful Matter command acknowledges acceptance. Use **来源系统 · 已核实** for Bond and **Apple 家庭 · 已核实** for HomeKit. Only selected fields are compared for each request. The HomeKit companion stores the confirmed binding on the iPhone and the exchange folder carries the matching public identifiers. Local aliases in MatterDesk remain available.
