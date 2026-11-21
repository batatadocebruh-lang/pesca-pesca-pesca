Option Explicit

Dim shell, fso, network, wmi
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set network = CreateObject("WScript.Network")
Set wmi = GetObject("winmgmts:\\.\root\cimv2")

Dim currentUser, scriptName, currentSessionId, fallbackSessionId
currentUser = LCase(Trim("" & network.UserName))
scriptName = LCase(WScript.ScriptName)
currentSessionId = -1
fallbackSessionId = -1

' 1) Descobrir SessionId da sessao atual pelo proprio wscript/cscript desta execucao
Dim procs, p, cmdText, procName, ownerUser, ownerDomain, rc, errNum
Set procs = wmi.ExecQuery("SELECT ProcessId, Name, CommandLine, SessionId FROM Win32_Process WHERE Name = 'wscript.exe' OR Name = 'cscript.exe'")
On Error Resume Next
For Each p In procs
    cmdText = "" & p.CommandLine
    If InStr(1, cmdText, scriptName, vbTextCompare) > 0 Then
        ownerUser = ""
        ownerDomain = ""
        rc = -1
        Err.Clear
        rc = p.GetOwner(ownerUser, ownerDomain)
        errNum = Err.Number
        If errNum = 0 And rc = 0 Then
            If LCase(Trim(ownerUser)) = currentUser Then
                currentSessionId = CLng(p.SessionId)
                Exit For
            End If
        ElseIf fallbackSessionId = -1 Then
            fallbackSessionId = CLng(p.SessionId)
        End If
    End If
Next
On Error GoTo 0

' Fallback: descobrir SessionId pelo explorer.exe do usuario atual
If currentSessionId = -1 Then
    Set procs = wmi.ExecQuery("SELECT ProcessId, SessionId FROM Win32_Process WHERE Name = 'explorer.exe'")
    On Error Resume Next
    For Each p In procs
        ownerUser = ""
        ownerDomain = ""
        rc = -1
        Err.Clear
        rc = p.GetOwner(ownerUser, ownerDomain)
        errNum = Err.Number
        If errNum = 0 And rc = 0 Then
            If LCase(Trim(ownerUser)) = currentUser Then
                currentSessionId = CLng(p.SessionId)
                Exit For
            End If
        End If
    Next
    On Error GoTo 0
End If

If currentSessionId = -1 And fallbackSessionId <> -1 Then
    currentSessionId = fallbackSessionId
End If

' 2) Verificar se ja existe bot ou terminal do bot aberto nesta sessao
Dim query
If currentSessionId >= 0 Then
    query = "SELECT ProcessId, Name, CommandLine, SessionId FROM Win32_Process WHERE SessionId = " & currentSessionId & " AND (Name = 'node.exe' OR Name = 'cmd.exe')"
Else
    query = "SELECT ProcessId, Name, CommandLine, SessionId FROM Win32_Process WHERE Name = 'node.exe' OR Name = 'cmd.exe'"
End If

Set procs = wmi.ExecQuery(query)
For Each p In procs
    If currentSessionId < 0 Then
        ownerUser = ""
        ownerDomain = ""
        rc = -1
        On Error Resume Next
        Err.Clear
        rc = p.GetOwner(ownerUser, ownerDomain)
        errNum = Err.Number
        On Error GoTo 0
        If errNum = 0 And rc = 0 And LCase(Trim(ownerUser)) = currentUser Then
            cmdText = "" & p.CommandLine
        Else
            cmdText = ""
        End If
    Else
        cmdText = "" & p.CommandLine
    End If

    If Len(cmdText) > 0 Then
        procName = LCase(Trim("" & p.Name))
        If procName = "node.exe" Then
            If InStr(1, cmdText, "dist\bot.js", vbTextCompare) > 0 Or InStr(1, cmdText, "dist/bot.js", vbTextCompare) > 0 Then
                WScript.Quit 0
            End If
        ElseIf procName = "cmd.exe" Then
            If InStr(1, cmdText, "Iniciar_Bot_Pesca.bat", vbTextCompare) > 0 Or InStr(1, cmdText, "Iniciar_Bot.bat", vbTextCompare) > 0 Then
                WScript.Quit 0
            End If
        End If
    End If
Next

' 3) Iniciar o bot ja minimizado na barra de tarefas (7 = SW_SHOWMINNOACTIVE)
Dim targetBat
If fso.FileExists("C:\Users\Public\Desktop\Iniciar_Bot_Pesca.bat") Then
    targetBat = "C:\Users\Public\Desktop\Iniciar_Bot_Pesca.bat"
ElseIf fso.FileExists("C:\pesca\Iniciar_Bot.bat") Then
    targetBat = "C:\pesca\Iniciar_Bot.bat"
Else
    targetBat = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "Iniciar_Bot.bat")
End If

If Not fso.FileExists(targetBat) Then
    WScript.Quit 1
End If

shell.Run "cmd.exe /c """ & targetBat & """", 7, False
