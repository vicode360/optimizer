use serde::{Deserialize, Serialize};

use crate::error::AppResult;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub device_name: String,
    pub adapter_string: String,
    pub width: u32,
    pub height: u32,
    pub refresh_rate_hz: u32,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputDeviceInfo {
    pub name: String,
    pub manufacturer: String,
    pub device_id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeripheralsSummary {
    pub monitors: Vec<MonitorInfo>,
    pub mice: Vec<InputDeviceInfo>,
    pub keyboards: Vec<InputDeviceInfo>,
}

pub fn collect_peripherals_summary() -> AppResult<PeripheralsSummary> {
    let monitors = enumerate_monitors();
    let (mice, keyboards) = query_input_devices_wmi();

    Ok(PeripheralsSummary {
        monitors,
        mice,
        keyboards,
    })
}

#[cfg(windows)]
fn enumerate_monitors() -> Vec<MonitorInfo> {
    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayDevicesW, EnumDisplaySettingsW, DEVMODEW, DISPLAY_DEVICEW,
        DISPLAY_DEVICE_ACTIVE, DISPLAY_DEVICE_PRIMARY_DEVICE, ENUM_CURRENT_SETTINGS,
    };

    let mut monitors = Vec::new();
    let mut index = 0u32;

    loop {
        let mut device = DISPLAY_DEVICEW {
            cb: std::mem::size_of::<DISPLAY_DEVICEW>() as u32,
            ..Default::default()
        };

        let ok = unsafe { EnumDisplayDevicesW(PCWSTR::null(), index, &mut device, 0) };
        if !ok.as_bool() {
            break;
        }
        index += 1;

        if (device.StateFlags & DISPLAY_DEVICE_ACTIVE) == 0 {
            continue;
        }

        let mut devmode = DEVMODEW {
            dmSize: std::mem::size_of::<DEVMODEW>() as u16,
            ..Default::default()
        };

        let has_mode = unsafe {
            EnumDisplaySettingsW(
                PCWSTR(device.DeviceName.as_ptr()),
                ENUM_CURRENT_SETTINGS,
                &mut devmode,
            )
        };

        if has_mode.as_bool() {
            monitors.push(MonitorInfo {
                device_name: utf16_slice_to_string(&device.DeviceName),
                adapter_string: utf16_slice_to_string(&device.DeviceString),
                width: devmode.dmPelsWidth,
                height: devmode.dmPelsHeight,
                refresh_rate_hz: devmode.dmDisplayFrequency,
                is_primary: (device.StateFlags & DISPLAY_DEVICE_PRIMARY_DEVICE) != 0,
            });
        }
    }

    monitors
}

#[cfg(not(windows))]
fn enumerate_monitors() -> Vec<MonitorInfo> {
    Vec::new()
}

fn utf16_slice_to_string(slice: &[u16]) -> String {
    let end = slice.iter().position(|&c| c == 0).unwrap_or(slice.len());
    String::from_utf16_lossy(&slice[..end])
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct WmiPointingDevice {
    name: Option<String>,
    manufacturer: Option<String>,
    #[serde(rename = "DeviceID")]
    device_id: Option<String>,
    status: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct WmiKeyboard {
    name: Option<String>,
    description: Option<String>,
    #[serde(rename = "DeviceID")]
    device_id: Option<String>,
    status: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct WmiPnpKeyboardEntity {
    #[serde(rename = "DeviceID")]
    device_id: Option<String>,
    manufacturer: Option<String>,
}

fn query_input_devices_wmi() -> (Vec<InputDeviceInfo>, Vec<InputDeviceInfo>) {
    std::thread::spawn(|| {
        let Ok(com) = wmi::COMLibrary::new() else {
            return (Vec::new(), Vec::new());
        };
        let Ok(wmi_con) = wmi::WMIConnection::new(com) else {
            return (Vec::new(), Vec::new());
        };

        let mice_rows: Vec<WmiPointingDevice> = wmi_con
            .raw_query("SELECT Name, Manufacturer, DeviceID, Status FROM Win32_PointingDevice")
            .unwrap_or_default();

        let kb_rows: Vec<WmiKeyboard> = wmi_con
            .raw_query("SELECT Name, Description, DeviceID, Status FROM Win32_Keyboard")
            .unwrap_or_default();

        let pnp_kb_rows: Vec<WmiPnpKeyboardEntity> = wmi_con
            .raw_query("SELECT DeviceID, Manufacturer FROM Win32_PnPEntity WHERE PNPClass = 'Keyboard'")
            .unwrap_or_default();

        let pnp_manufacturers: std::collections::HashMap<String, String> = pnp_kb_rows
            .into_iter()
            .filter_map(|row| {
                let id = row.device_id?.trim().to_ascii_lowercase();
                let mfg = row.manufacturer?.trim().to_string();
                if id.is_empty() || mfg.is_empty() {
                    None
                } else {
                    Some((id, mfg))
                }
            })
            .collect();

        let mice = mice_rows
            .into_iter()
            .map(|m| InputDeviceInfo {
                name: m.name.unwrap_or_else(|| "Dispositivo Apontador".into()),
                manufacturer: m.manufacturer.unwrap_or_else(|| "-".into()),
                device_id: m.device_id.unwrap_or_default(),
                status: m.status.unwrap_or_else(|| "OK".into()),
            })
            .collect();

        let keyboards = kb_rows
            .into_iter()
            .map(|k| {
                let dev_id = k.device_id.unwrap_or_default();
                let manufacturer = pnp_manufacturers
                    .get(&dev_id.trim().to_ascii_lowercase())
                    .cloned()
                    .unwrap_or_else(|| "HID / Padrão".into());

                InputDeviceInfo {
                    name: k
                        .description
                        .or(k.name)
                        .unwrap_or_else(|| "Teclado HID".into()),
                    manufacturer,
                    device_id: dev_id,
                    status: k.status.unwrap_or_else(|| "OK".into()),
                }
            })
            .collect();

        (mice, keyboards)
    })
    .join()
    .unwrap_or_default()
}
