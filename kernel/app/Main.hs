{-# LANGUAGE OverloadedStrings #-}

module Main (main) where

import Data.Aeson
import Data.Aeson.Types (Parser, parseEither)
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy.Char8 as L
import Data.Text (Text)
import System.IO (stdin)
import Paths_zither_kernel (getDataFileName)
import Zither.Catalog (describeOperation)
import Zither.Tree

data Request = Inspect Value | Compile Value Text Text [(Text, Text)] | Catalog Text

instance FromJSON Request where
  parseJSON = withObject "request" $ \o -> do
    version <- o .: "version"
    if version /= (1 :: Int) then fail "Unsupported protocol version" else do
      action <- o .: "action" :: Parser Text
      case action of
        "inspect" -> Inspect <$> o .: "tree"
        "compile" -> do
          edits <- o .: "edits" >>= traverse (withObject "edit" (\e -> (,) <$> e .: "parameterId" <*> e .: "expression"))
          Compile <$> o .: "tree" <*> o .: "expectedMicroversion" <*> o .: "featureId" <*> pure edits
        "catalog" -> Catalog <$> o .: "operationId"
        _ -> fail "Unknown kernel action"

run :: Request -> IO (Either String Value)
run (Inspect value) = pure (observe <$> importTree value)
run (Compile value revision fid edits) = pure (importTree value >>= \tree -> compileEdit tree revision fid edits)
run (Catalog name) = do
  file <- getDataFileName "schema/onshape-openapi.json"
  schema <- eitherDecodeFileStrict' file
  pure (schema >>= \spec -> describeOperation spec name)

main :: IO ()
main = do
  input <- B.hGet stdin (16 * 1024 * 1024 + 1)
  result <- if B.length input > 16 * 1024 * 1024 then pure (Left "Feature tree exceeds 16 MiB") else
    case eitherDecodeStrict' input >>= parseEither parseJSON of
      Left _ -> pure (Left "Invalid kernel request")
      Right request -> run request
  L.putStrLn $ encode $ either (\message -> object ["error" .= message]) id result
