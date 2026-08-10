@echo off
REM ===========================================================================
REM  sync-user-layer.cmd — enveloppe Windows pour la synchronisation planifiee.
REM
REM  POURQUOI CETTE ENVELOPPE : le Planificateur de taches ne demarre PAS avec le
REM  meme PATH qu'un terminal. `ssh` et `scp` viennent de Git pour Windows et ne
REM  sont pas forcement visibles ; sans eux la tache echouerait en silence toutes
REM  les 15 minutes, ce qui est exactement le mode de panne que cette
REM  synchronisation existe pour supprimer.
REM
REM  Le chemin du depot est deduit de l'emplacement de ce fichier (%~dp0..), pas
REM  code en dur : deplacer le dossier ne casse pas la tache.
REM
REM  Journal : deploy\sync-user-layer.log (ignore par git, il contient des noms
REM  de fichiers personnels). Code de sortie 2 = conflit a trancher a la main.
REM ===========================================================================

setlocal
set "REPO=%~dp0.."
cd /d "%REPO%" || exit /b 1

where ssh >nul 2>&1 || set "PATH=%PATH%;C:\Program Files\Git\usr\bin"
where scp >nul 2>&1 || set "PATH=%PATH%;C:\Program Files\Git\usr\bin"

set "LOG=%~dp0sync-user-layer.log"
echo. >> "%LOG%"
echo ===== %DATE% %TIME% ===== >> "%LOG%"
node "%~dp0sync-user-layer.mjs" >> "%LOG%" 2>&1
set CODE=%ERRORLEVEL%
echo (code de sortie %CODE%) >> "%LOG%"
exit /b %CODE%
