; Inno Setup script for TradeOps. Build with release.bat (it passes /DAppVersion=<VERSION file>).
; Per-user install: no administrator rights needed. Customer data (%LOCALAPPDATA%\TradeOps) is
; never touched by install/upgrade, and uninstall asks before removing it.

#ifndef AppVersion
  #define AppVersion "1.0.1"
#endif
#define AppName "TradeOps"
#define AppExe "TradeOps.exe"

[Setup]
; Keep this AppId forever: it is how a new installer recognises and upgrades an old install.
AppId={{870981AB-C102-4521-ABDB-1E23E4AC37A8}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=TradeOps
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=TradeOps-Setup-{#AppVersion}
SetupIconFile=..\assets\icon.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
WizardImageFile=..\assets\installer-banner.bmp
WizardSmallImageFile=..\assets\installer-small.bmp
WizardStyle=modern
Compression=lzma2/ultra64
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
; A running TradeOps is stopped by PrepareToInstall below (Restart Manager cannot close this app).

CloseApplications=no
RestartApplications=no
VersionInfoVersion={#AppVersion}
VersionInfoProductName={#AppName}

[Languages]
Name: "arabic"; MessagesFile: "compiler:Languages\Arabic.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Types]
Name: "full"; Description: "Full (with WhatsApp support) / كاملة مع دعم واتساب"
Name: "compact"; Description: "Compact (no WhatsApp) / مضغوطة بدون واتساب"
Name: "custom"; Description: "Custom / مخصصة"; Flags: iscustom

[Components]
Name: "main"; Description: "TradeOps"; Types: full compact custom; Flags: fixed
Name: "whatsapp"; Description: "WhatsApp support / دعم واتساب (~60 MB)"; Types: full

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: checkedonce

[Files]
Source: "..\dist\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion; Components: main
; The optional WhatsApp gateway (Node + Baileys). Prepared by release.bat in whatsapp-service\.
Source: "..\whatsapp-service\*"; DestDir: "{app}\whatsapp-service"; Flags: ignoreversion recursesubdirs createallsubdirs; Components: whatsapp; Excludes: ".session\*"

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Make sure the program is not running while it is removed.
Filename: "{cmd}"; Parameters: "/C taskkill /F /IM {#AppExe}"; Flags: runhidden; RunOnceId: "StopTradeOps"

[Code]
const
  WebView2Key = '\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

function WebView2Installed: Boolean;
var
  Version: String;
begin
  Result :=
    (RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node' + WebView2Key, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')) or
    (RegQueryStringValue(HKLM, 'SOFTWARE' + WebView2Key, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')) or
    (RegQueryStringValue(HKCU, 'Software' + WebView2Key, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0'));
end;

// The optional WhatsApp gateway runs as node.exe from {app}\whatsapp-service. If it is still alive
// (the app was killed, or crashed) Windows refuses to replace node.exe, so stop exactly those processes.
procedure StopWhatsappService;
var
  ResultCode: Integer;
  Dir, Params: String;
begin
  Dir := ExpandConstant('{app}\whatsapp-service\');
  Params := '-NoProfile -ExecutionPolicy Bypass -Command "Get-Process -Name node -ErrorAction SilentlyContinue | ' +
            'Where-Object { $_.Path -like ''' + Dir + '*'' } | Stop-Process -Force"';
  if Exec('powershell.exe', Params, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    Log('StopWhatsappService finished, exit code ' + IntToStr(ResultCode))
  else
    Log('StopWhatsappService: could not start powershell');
end;

// Upgrades: make sure a running TradeOps is stopped before its exe is replaced.
// (Customer data is committed to the database on every action, so nothing is lost.)
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  if Exec(ExpandConstant('{cmd}'), '/C taskkill /F /IM {#AppExe}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    Log('PrepareToInstall: taskkill finished, exit code ' + IntToStr(ResultCode) + ' (0 = stopped a running TradeOps, 128 = none was running)')
  else
    Log('PrepareToInstall: could not start taskkill');
  StopWhatsappService;
  Sleep(1000);
end;

function InitializeSetup: Boolean;
begin
  Result := True;
  if (not WizardSilent) and (not WebView2Installed) then
    MsgBox('Microsoft Edge WebView2 Runtime was not found on this PC.' + #13#10 +
           'TradeOps will still work: it opens in your web browser instead of its own window.' + #13#10#13#10 +
           'لم يتم العثور على Microsoft Edge WebView2 Runtime. سيعمل البرنامج بشكل طبيعي لكنه سيفتح في المتصفح بدلاً من نافذته الخاصة.',
           mbInformation, MB_OK);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
begin
  if CurUninstallStep = usUninstall then
    StopWhatsappService;
  if (CurUninstallStep = usPostUninstall) and (not UninstallSilent) then
  begin
    DataDir := ExpandConstant('{localappdata}\TradeOps');
    if DirExists(DataDir) then
      if MsgBox('Delete your TradeOps data too (database, backups, settings)?' + #13#10 +
                'This cannot be undone. Choose No to keep it for a future reinstall.' + #13#10#13#10 +
                'هل تريد حذف بيانات البرنامج أيضاً (قاعدة البيانات والنسخ الاحتياطية)؟ لا يمكن التراجع. اختر «لا» للاحتفاظ بها.',
                mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(DataDir, True, True, True);
  end;
end;
