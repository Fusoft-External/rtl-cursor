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
cmd = "powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & ps1 & """"
sh.Run cmd, 0, False
