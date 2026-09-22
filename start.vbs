Option Explicit

Dim shell, files, root, command, result
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
command = Quote(shell.ExpandEnvironmentStrings("%ComSpec%")) & " /d /s /c " & Quote(Quote(files.BuildPath(root, "start.bat")) & " --background")
result = shell.Run(command, 0, True)
If result <> 0 Then
    shell.Popup "Could not start Canvas. See " & files.BuildPath(root, "web\launcher.log"), 0, "Canvas Launcher", 16
End If
WScript.Quit result

Function Quote(value)
    Quote = Chr(34) & value & Chr(34)
End Function
