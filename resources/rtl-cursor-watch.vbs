' Hidden launcher for rtl-cursor-watch.ps1.
' WScript.Shell.Run style 0 avoids Windows Terminal showing an empty console
' when PowerShell is the default startup app.
Option Explicit
Dim sh, fso, dir, ps1, cmd
Set sh = CreateObject("Wscript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = dir & "\rtl-cursor-watch.ps1"
If Not fso.FileExists(ps1) Then
  WScript.Quit 1
End If
' Registry writes and the running-watcher check stay inside this windowless
' script. powershell.exe and reg.exe are console programs and flash a window.
sh.RegWrite "HKCU\Software\Microsoft\Windows\CurrentVersion\Run\RtlCursorWatch", "wscript.exe //nologo //B """ & WScript.ScriptFullName & """", "REG_SZ"
lockPath = dir & "\watch.lock"
If fso.FileExists(lockPath) Then
  On Error Resume Next
  Dim held
  Set held = fso.OpenTextFile(lockPath, 1, False)
  If Err.Number <> 0 Then
    WScript.Quit 0
  End If
  held.Close
  On Error GoTo 0
End If
cmd = "powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & ps1 & """"
sh.Run cmd, 0, False
